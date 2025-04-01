require('dotenv').config({ path: './.env.local' });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const { AccessToken, RoomServiceClient, SipParticipant } = require('livekit-server-sdk');
const { v4: uuidv4 } = require('uuid');
const livekitAgentManager = require('./services/livekit-agent-manager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
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

// Initiate SIP call to Twilio
app.post('/call', async (req, res) => {
  try {
    const { room, phoneNumber } = req.body;
    
    if (!room || !phoneNumber) {
      return res.status(400).json({ error: 'Room and phone number are required' });
    }

    // Ensure AI agent is created for this room
    await livekitAgentManager.createAgentForRoom(room);

    // Format the SIP URI for outbound calling through Twilio
    // The format depends on your Twilio SIP trunk configuration
    const sipUri = `sip:${process.env.TWILIO_TRUNK_SID}@${phoneNumber}@sip.twilio.com`;
    
    // Create a unique participant ID for this call
    const participantId = `sip-call-${uuidv4()}`;
    
    // Define SIP participant
    const sipParticipant = new SipParticipant({
      identity: participantId,
      uri: sipUri,
      // You can set additional SIP headers here if needed
      name: `Patient Call to ${phoneNumber}`,
    });

    // Add the SIP participant to the room
    const result = await roomService.addSipParticipant(room, sipParticipant);

    res.json({
      success: true,
      callId: participantId,
      aiAgent: true,
      result
    });
  } catch (error) {
    console.error('SIP call error:', error);
    res.status(500).json({ error: 'Failed to initiate SIP call', details: error.message });
  }
});

// Disconnect SIP call
app.post('/hangup', async (req, res) => {
  try {
    const { room, participantId } = req.body;
    
    if (!room || !participantId) {
      return res.status(400).json({ error: 'Room and participant ID are required' });
    }

    // Remove the SIP participant from the room
    await roomService.removeParticipant(room, participantId);

    // Also remove the AI agent when call ends
    livekitAgentManager.removeAgentFromRoom(room);

    res.json({ success: true });
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

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`LiveKit Host: ${livekitHost}`);
});