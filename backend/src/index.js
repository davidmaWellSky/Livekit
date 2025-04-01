require('dotenv').config({ path: './.env.local' });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const { AccessToken, RoomServiceClient, SipParticipant } = require('livekit-server-sdk');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const livekitAgentManager = require('./services/livekit-agent-manager');
const twilioService = require('./services/twilio.service');
const deepgramService = require('./services/deepgram.service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Try different ports if initial one is in use
const BASE_PORT = process.env.PORT || 8888;
let PORT = BASE_PORT;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.raw({ type: 'audio/*', limit: '10mb' })); // For audio processing
app.use(morgan('dev'));

// LiveKit Server Configuration
const livekitHost = process.env.LIVEKIT_HOST || 'livekit:7880';
const livekitApiKey = process.env.LIVEKIT_API_KEY || 'devkey';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || 'secret';

// Create a Room Service Client
const roomService = new RoomServiceClient(
  `http://${livekitHost}`,
  livekitApiKey,
  livekitApiSecret
);

// Socket.IO connection for real-time communication
io.on('connection', (socket) => {
  console.log('New client connected', socket.id);
  
  // Listen for chat messages from patients
  socket.on('patient-message', async (data) => {
    try {
      const { roomName, message, patientName } = data;
      console.log(`Received message from ${patientName} in room ${roomName}: ${message}`);
      
      // Ensure AI agent exists for this room
      await livekitAgentManager.createAgentForRoom(roomName);
      
      // Process message through AI agent
      const agentResponse = await livekitAgentManager.processPatientMessage(roomName, message, patientName);
      
      // Send AI response back to client
      io.to(roomName).emit('agent-message', {
        agentName: 'GeminiAgent',
        message: agentResponse,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error processing patient message:', error);
      socket.emit('error', { message: 'Failed to process message' });
    }
  });
  
  // Join a room for socket communication
  socket.on('join-room', (roomName) => {
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });
  
  // Leave a room
  socket.on('leave-room', (roomName) => {
    socket.leave(roomName);
    console.log(`Socket ${socket.id} left room ${roomName}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

// Routes

// Generate access token for frontend
app.post('/token', async (req, res) => {
  try {
    const { room } = req.body;
    
    if (!room) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    // Create a unique identity for the patient
    const identity = `patient-${uuidv4().substring(0, 8)}`;
    
    // Create access token with identity
    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity,
      ttl: 3600 * 24, // 24 hours
    });

    // Add room grant
    at.addGrant({ roomJoin: true, roomCreate: true, room });

    // Automatically create an AI agent for this room
    await livekitAgentManager.createAgentForRoom(room);

    // Return the token
    res.json({ 
      token: at.toJwt(),
      identity,
      aiAgent: true,
      roomName: room
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// List available rooms
app.get('/rooms', async (req, res) => {
  try {
    const rooms = await roomService.listRooms();
    res.json({ rooms });
  } catch (error) {
    console.error('List rooms error:', error);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

// Create room if it doesn't exist
app.post('/rooms', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    // Create empty room
    await roomService.createRoom({
      name,
      emptyTimeout: 60 * 60, // 1 hour
      maxParticipants: 10
    });

    // Automatically create AI agent for this room
    await livekitAgentManager.createAgentForRoom(name);

    res.json({ 
      success: true, 
      room: name,
      aiAgent: true 
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Initiate outbound call to patient via Twilio
app.post('/call', async (req, res) => {
  try {
    const { room, phoneNumber, message } = req.body;
    
    if (!room || !phoneNumber) {
      return res.status(400).json({ error: 'Room and phone number are required' });
    }
    
    // Use LiveKit Agent Manager to initiate the call
    const callDetails = await livekitAgentManager.callPatient(room, phoneNumber, {
      initialMessage: message,
      baseUrl: `http://${req.hostname}:${PORT}`,
      hostname: req.hostname
    });
    
    res.json({
      success: true,
      ...callDetails
    });
  } catch (error) {
    console.error('Call error:', error);
    res.status(500).json({ error: 'Failed to initiate call', details: error.message });
  }
});
// End active call
app.post('/hangup', async (req, res) => {
  try {
    const { room } = req.body;
    
    if (!room) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    // End the call
    const success = await livekitAgentManager.endCall(room);
    
    // Also remove the AI agent when call ends
    if (success) {
      livekitAgentManager.removeAgentFromRoom(room);
    }
    
    res.json({ success });
  } catch (error) {
    console.error('Hangup error:', error);
    res.status(500).json({ error: 'Failed to hang up call', details: error.message });
  }
});

// AI Agent endpoints

// Get AI agent status
app.get('/ai-agent/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    const agent = livekitAgentManager.getAgentForRoom(roomName);
    
    if (!agent) {
      return res.status(404).json({ 
        exists: false,
        message: 'No AI agent found for this room' 
      });
    }
    
    res.json({
      exists: true,
      roomName,
      agentId: agent.agent.getIdentity().id,
      agentName: agent.agent.getIdentity().name
    });
  } catch (error) {
    console.error('AI agent status error:', error);
    res.status(500).json({ error: 'Failed to get AI agent status' });
  }
});

// Create AI agent for a room
app.post('/ai-agent/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    const agentInfo = await livekitAgentManager.createAgentForRoom(roomName);
    
    res.json({
      success: true,
      ...agentInfo
    });
  } catch (error) {
    console.error('AI agent creation error:', error);
    res.status(500).json({ error: 'Failed to create AI agent' });
  }
});

// ================ TWILIO WEBHOOK ROUTES ================

// Handle incoming Twilio webhook for call status updates
app.post('/twilio/call-status', (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    
    console.log(`Twilio call ${callSid} status update: ${callStatus}`);
    
    // You can add custom logic here based on the call status
    
    // Send TwiML response back to Twilio
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    console.error('Error handling Twilio status webhook:', error);
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }
});

// Connect incoming call to a LiveKit room
app.post('/twilio/connect-to-room', (req, res) => {
  try {
    const roomName = req.query.roomName;
    
    if (!roomName) {
      console.error('No room name provided in connect-to-room webhook');
      res.set('Content-Type', 'text/xml');
      res.send(`
        <Response>
          <Say>I'm sorry, but there was an error connecting your call. Goodbye.</Say>
          <Hangup />
        </Response>
      `);
      return;
    }
    
    console.log(`Connecting Twilio call to room: ${roomName}`);
    
    // Generate TwiML to connect the call to the LiveKit room
    // In a production system, you would include SIP connection details here
    const twiml = `
      <Response>
        <Say>Thank you for calling. You are now being connected to your healthcare scheduling assistant.</Say>
        <Pause length="1"/>
        <Say>The agent will help you schedule your appointment. Please wait while we get started.</Say>
        <!-- In a production system, you would use <Dial> with <Sip> to connect to LiveKit -->
        <Stream url="wss://${req.hostname}:${PORT}/twilio/media-stream?roomName=${roomName}">
          <Parameter name="roomName" value="${roomName}"/>
        </Stream>
      </Response>
    `;
    
    res.set('Content-Type', 'text/xml');
    res.send(twiml);
  } catch (error) {
    console.error('Error handling connect-to-room webhook:', error);
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say>I'm sorry, but there was an error connecting your call. Goodbye.</Say>
        <Hangup />
      </Response>
    `);
  }
});

// ================ DEEPGRAM AUDIO PROCESSING ================

// Handle audio for speech-to-text (batch processing)
app.post('/audio/transcribe', async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Audio data is required' });
    }
    
    const audioData = req.body;
    const mimetype = req.headers['content-type'] || 'audio/webm';
    const language = req.query.language || 'en-US';
    
    const transcript = await deepgramService.speechToText(audioData, {
      mimetype,
      language
    });
    
    res.json({ transcript });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// Convert text to speech
app.post('/audio/synthesize', async (req, res) => {
  try {
    const { text, voice, language } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    const audioData = await deepgramService.textToSpeech(text, {
      voice: voice || 'female-1',
      language: language || 'en-US'
    });
    
    res.set('Content-Type', 'audio/wav');
    res.send(audioData);
  } catch (error) {
    console.error('Error synthesizing speech:', error);
    res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});

// Process audio and get AI response
app.post('/agent/process-audio', async (req, res) => {
  try {
    const { roomName } = req.query;
    
    if (!roomName) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    if (!req.body || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Audio data is required' });
    }
    
    const audioData = req.body;
    const mimetype = req.headers['content-type'] || 'audio/webm';
    
    // Process audio with AI agent
    const response = await livekitAgentManager.processPatientAudio(roomName, audioData, {
      mimetype,
      patientName: req.query.patientName
    });
    
    if (response.audio) {
      res.set('Content-Type', 'audio/wav');
      res.send(response.audio);
    } else {
      res.json({ text: response.text });
    }
  } catch (error) {
    console.error('Error processing audio with agent:', error);
    res.status(500).json({ error: 'Failed to process audio with agent' });
  }
});

// Function to start the server on a given port
function startServer(port) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is already in use, trying next port...`);
        resolve(false);
      } else {
        reject(err);
      }
    });
    
    server.once('listening', () => {
      console.log(`Server is running on port ${port}`);
      console.log(`LiveKit Host: ${livekitHost}`);
      console.log(`Deepgram URL: ${process.env.DEEPGRAM_URL || 'http://localhost:9012'}`);
      resolve(true);
    });
    
    server.listen(port);
  });
}

// Try to start the server on different ports
async function tryPorts() {
  let currentPort = PORT;
  const maxAttempts = 10;
  
  for (let i = 0; i < maxAttempts; i++) {
    const success = await startServer(currentPort);
    if (success) {
      // Update the global PORT variable to the one that worked
      PORT = currentPort;
      return;
    }
    currentPort++;
  }
  
  console.error(`Failed to find an available port after ${maxAttempts} attempts.`);
  process.exit(1);
}

// Start the server with port retry logic
tryPorts().catch(err => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});