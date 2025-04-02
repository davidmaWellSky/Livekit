require('dotenv').config({ path: './.env.local' });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const expressWs = require('express-ws');
const socketIo = require('socket.io');
const { AccessToken, RoomServiceClient, SipParticipant } = require('livekit-server-sdk');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const livekitAgentManager = require('./services/livekit-agent-manager');
const twilioService = require('./services/twilio.service');
const deepgramService = require('./services/deepgram.service');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket support
expressWs(app, server);

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
    const { name, phoneNumber } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    // Create empty room
    await roomService.createRoom({
      name,
      emptyTimeout: 60 * 60, // 1 hour
      maxParticipants: 10
    });

    // Send response immediately after room creation
    res.json({
      success: true,
      room: name,
      aiAgent: true
    });
    
    // Create AI agent in the background (non-blocking)
    // This prevents timeout issues while waiting for agent creation
    livekitAgentManager.createAgentForRoom(name)
      .then(() => {
        console.log(`AI agent created for room ${name} in background`);
      })
      .catch(agentError => {
        console.error(`Error creating AI agent for room ${name} in background:`, agentError);
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
    
    if (!room) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    if (!phoneNumber || phoneNumber.trim() === '') {
      return res.status(400).json({ error: 'Phone number is required to make a call' });
    }
    
    // Ensure the room exists before making the call
    await livekitAgentManager.ensureRoomExists(room);
    
    // Use LiveKit Agent Manager to initiate the call
    // Use localhost or the PUBLIC_HOSTNAME env var instead of req.hostname for Twilio callbacks
    const publicHostname = process.env.PUBLIC_HOSTNAME || 'localhost';
    const callDetails = await livekitAgentManager.callPatient(room, phoneNumber, {
      initialMessage: message,
      baseUrl: `http://${publicHostname}:${PORT}`,
      hostname: publicHostname
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
    const { room, participantId } = req.body;
    
    if (!room) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    // End the call - we no longer need the participantId since we're tracking by room
    const result = await livekitAgentManager.endCall(room);
    
    // Also remove the AI agent when call ends
    if (result && result.success) {
      livekitAgentManager.removeAgentFromRoom(room);
    }
    
    res.json(result || { success: false });
  } catch (error) {
    console.error('Hangup error:', error);
    res.status(500).json({ error: 'Failed to hang up call', details: error.message });
  }
});

// Get the status of an active call in a room
app.get('/call-status/:room', async (req, res) => {
  try {
    const { room } = req.params;
    
    if (!room) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    // Get active call details from LiveKit agent manager
    const callDetails = livekitAgentManager.getCallDetails(room);
    
    if (!callDetails) {
      return res.json({
        active: false,
        status: 'no-call',
        message: 'No active call found for this room'
      });
    }
    
    // If we have call details, we can get more info from Twilio if needed
    let twilioStatus = callDetails.status;
    
    // If the call is more than a few seconds old, check current status from Twilio
    const callAge = (new Date() - new Date(callDetails.startTime)) / 1000;
    if (callAge > 5 && callDetails.sid) {
      try {
        const twilioCallInfo = await twilioService.getCallInfo(callDetails.sid);
        twilioStatus = twilioCallInfo.status;
        
        // Update our status
        callDetails.status = twilioStatus;
        
        // Mark call as connected if answered
        if (!callDetails.connected &&
            (twilioStatus === 'in-progress' || twilioStatus === 'answered')) {
          callDetails.connected = true;
          console.log(`Call ${callDetails.sid} marked as connected in room ${room}`);
        }
      } catch (twilioError) {
        console.log(`Error getting Twilio status for call ${callDetails.sid}: ${twilioError.message}`);
      }
    }
    
    res.json({
      active: callDetails.connected || twilioStatus === 'in-progress' || twilioStatus === 'ringing',
      status: twilioStatus,
      callSid: callDetails.sid,
      phoneNumber: callDetails.phoneNumber,
      startTime: callDetails.startTime,
      participantId: callDetails.participantId,
      connected: callDetails.connected || false
    });
  } catch (error) {
    console.error('Call status error:', error);
    res.status(500).json({ error: 'Failed to get call status', details: error.message });
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
app.post('/twilio/call-status', async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    
    console.log(`Twilio call ${callSid} status update: ${callStatus}`);
    
    // Handle completed or failed calls
    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
      // Find which room is using this call SID
      for (const roomName of livekitAgentManager.getRoomsWithActiveCalls()) {
        const callDetails = livekitAgentManager.getCallDetails(roomName);
        
        if (callDetails && callDetails.sid === callSid) {
          console.log(`Call ${callSid} in room ${roomName} has ended with status: ${callStatus}`);
          
          // End the call in our system
          await livekitAgentManager.markCallEnded(roomName, callSid);
          
          // Broadcast status update via Socket.IO if needed
          if (io) {
            io.to(roomName).emit('call-status-update', {
              roomName,
              callSid,
              status: callStatus,
              active: false
            });
          }
          
          break;
        }
      }
    }
    
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
        <Stream url="wss://${process.env.PUBLIC_HOSTNAME || 'localhost'}:${PORT}/twilio/media-stream?roomName=${roomName}">
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
// Handle Twilio SIP status updates - Enhanced with detailed logging
app.post('/twilio/sip-status', (req, res) => {
  try {
    const sipCallId = req.body.CallSid;
    const sipStatus = req.body.SipStatus || req.body.CallStatus;
    const callLegId = req.body.CallLegSid;
    const errorCode = req.body.ErrorCode;
    const errorMessage = req.body.ErrorMessage;
    
    // Log all request parameters for debugging
    console.log(`Twilio SIP ${sipCallId} status update: ${sipStatus}`, {
      callSid: sipCallId,
      status: sipStatus,
      callLegId,
      timestamp: new Date().toISOString(),
      allParams: req.body,
      hasError: !!errorCode
    });
    
    // Log detailed error information if present
    if (errorCode) {
      console.error(`[CRITICAL] SIP ERROR: Code ${errorCode} - ${errorMessage || 'No message'}`, {
        errorCode,
        errorMessage,
        callSid: sipCallId,
        status: sipStatus
      });
      
      // Try to find which room this call belongs to
      for (const roomName of livekitAgentManager.getRoomsWithActiveCalls()) {
        const callDetails = livekitAgentManager.getCallDetails(roomName);
        if (callDetails && callDetails.sid === sipCallId) {
          console.error(`SIP error occurred in room ${roomName}`);
          // Optionally notify clients via socket.io
          if (io) {
            io.to(roomName).emit('call-error', {
              roomName,
              callSid: sipCallId,
              errorCode,
              errorMessage: errorMessage || 'Unknown error',
              status: sipStatus
            });
          }
          break;
        }
      }
    }
    
    // Set proper content type for TwiML response
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    console.error('Error handling SIP status webhook:', error);
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }
});

// Handle recording status updates
app.post('/twilio/recording-status', (req, res) => {
  try {
    const recordingStatus = req.body.RecordingStatus;
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    
    console.log(`Recording status update for call ${callSid}: ${recordingStatus}`, {
      url: recordingUrl,
      duration: req.body.RecordingDuration,
      allParams: req.body
    });
    
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    console.error('Error handling recording status webhook:', error);
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }
});

// Handle Dial action status with enhanced error detection
app.post('/twilio/dial-status', (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const dialStatus = req.body.DialStatus;
    const dialCallSid = req.body.DialCallSid;
    const errorCode = req.body.ErrorCode;
    const errorMessage = req.body.ErrorMessage;
    
    // Create a detailed log of dial status
    const logData = {
      callSid,
      dialStatus,
      dialCallSid,
      timestamp: new Date().toISOString(),
      allParams: req.body
    };
    
    // If we have error information, add it to the log
    if (errorCode) {
      logData.errorCode = errorCode;
      logData.errorMessage = errorMessage;
      console.error(`[CRITICAL] Dial ERROR: Code ${errorCode} - ${errorMessage || 'No message'}`, logData);
    } else {
      console.log(`Twilio Dial ${callSid} completed with status: ${dialStatus}`, logData);
    }
    
    // Send appropriate TwiML response based on dial status
    res.set('Content-Type', 'text/xml');
    
    if (dialStatus === 'completed' || dialStatus === 'answered') {
      res.send('<Response><Say>The call has completed. Thank you for using our service.</Say></Response>');
    } else {
      // If we have error details, include them in the response
      if (errorCode) {
        res.send(`<Response><Say>We encountered an error with code ${errorCode}. ${errorMessage || 'Please try again later.'}</Say></Response>`);
      } else {
        res.send('<Response><Say>We were unable to complete your call. Please try again later.</Say></Response>');
      }
    }
  } catch (error) {
    console.error('Error handling dial status webhook:', error);
    res.set('Content-Type', 'text/xml');
    res.send('<Response><Say>An error occurred. Please try again later.</Say></Response>');
  }
});

// Call diagnostic endpoint to check SIP configuration
app.get('/diagnostics/sip-config', (req, res) => {
  const config = {
    hasSipInfo: !!(process.env.TWILIO_TRUNK_SID &&
                 process.env.TWILIO_TERMINATION_URI &&
                 process.env.TWILIO_CREDENTIAL_LIST_USERNAME &&
                 process.env.TWILIO_CREDENTIAL_LIST_PASSWORD),
    trunkSid: process.env.TWILIO_TRUNK_SID ? 'Set' : 'Not Set',
    terminationUri: process.env.TWILIO_TERMINATION_URI,
    publicHostname: process.env.PUBLIC_HOSTNAME || 'localhost',
    deepgramUrl: process.env.DEEPGRAM_URL || 'http://localhost:9012',
    port: PORT
  };
  
  res.json(config);
});

// Handle Twilio media streaming with enhanced error handling
app.ws('/twilio/media', (ws, req) => {
  console.log('Twilio media stream connected');
  
  const roomName = req.query.roomName;
  if (!roomName) {
    console.error('No room name provided for media stream');
    try {
      ws.send(JSON.stringify({ error: 'Missing roomName parameter', fatal: true }));
    } catch (e) { /* Ignore send errors */ }
    ws.close();
    return;
  }
  
  // Track data for debugging
  let packetsReceived = 0;
  let audioChunks = [];
  let processingTimeout = null;
  let lastProcessedTime = 0;
  let errorCount = 0;
  const connectionStartTime = new Date();
  
  // Log connection details
  console.log(`WebSocket media connection established for room ${roomName}`, {
    timestamp: connectionStartTime.toISOString(),
    query: req.query,
    headers: req.headers,
    connectionId: ws._socket?.remoteAddress || 'unknown'
  });
  
  // Get the agent for this room
  const agentData = livekitAgentManager.getAgentForRoom(roomName);
  if (!agentData) {
    console.error(`No agent found for room ${roomName} in media stream handler`);
    try {
      ws.send(JSON.stringify({
        error: 'No agent found for this room',
        fatal: false,
        message: 'Agent not found, but connection will remain open'
      }));
    } catch (e) { /* Ignore send errors */ }
    // Don't close the connection yet, as the agent might be created later
    
    // Try to create an agent for this room asynchronously
    livekitAgentManager.createAgentForRoom(roomName)
      .then(agent => {
        console.log(`Created new agent for room ${roomName} after WebSocket connection`);
        try {
          ws.send(JSON.stringify({
            message: 'Agent created successfully',
            agentId: agent.agentId
          }));
        } catch (e) { /* Ignore send errors */ }
      })
      .catch(err => {
        console.error(`Failed to create agent for room ${roomName} after WebSocket connection:`, err);
      });
  } else {
    console.log(`Found agent for room ${roomName}: ${agentData.agent.getIdentity().id}`);
  }
  
  // Function to handle errors during audio processing
  const handleProcessingError = (error) => {
    errorCount++;
    console.error(`Error processing audio for room ${roomName} (error #${errorCount}):`, error);
    
    // Send error back to client
    try {
      ws.send(JSON.stringify({
        error: error.message || 'Unknown error processing audio',
        fatal: errorCount > 5, // Consider fatal after multiple errors
        errorCount
      }));
    } catch (e) { /* Ignore send errors */ }
    
    // If too many errors, close the connection
    if (errorCount > 10) {
      console.error(`Too many errors (${errorCount}) for room ${roomName}, closing WebSocket`);
      try {
        ws.close();
      } catch (e) { /* Ignore close errors */ }
    }
  };
  
  ws.on('message', async (data) => {
    try {
      packetsReceived++;
      
      // Add data to audio chunks
      audioChunks.push(data);
      
      // Log occasional status updates
      if (packetsReceived % 50 === 0) {
        console.log(`Received ${packetsReceived} media packets for room ${roomName}, buffer size: ${audioChunks.length}`);
      }
      
      // Process audio every 2 seconds to capture enough speech
      const now = Date.now();
      if (!processingTimeout && (now - lastProcessedTime) > 2000 && audioChunks.length > 0) {
        processingTimeout = setTimeout(async () => {
          try {
            // Clear timeout and reset for next processing
            processingTimeout = null;
            lastProcessedTime = Date.now();
            
            // Combine audio chunks into a single buffer
            const combinedAudio = Buffer.concat(audioChunks);
            audioChunks = []; // Clear buffer after processing
            
            console.log(`Processing ${combinedAudio.length} bytes of audio for room ${roomName}`);
            
            // Get the agent for this room (check again in case it was created after connection)
            const currentAgentData = livekitAgentManager.getAgentForRoom(roomName);
            if (!currentAgentData) {
              console.error(`No agent found for room ${roomName} during audio processing`);
              return;
            }
            
            // Process the audio with the agent - explicitly set telephony options
            const response = await currentAgentData.agent.processAudio(combinedAudio, {
              mimetype: 'audio/x-mulaw',  // Common format for Twilio telephony
              source: 'phone',
              telephony: true,
              sampleRate: 8000,  // Standard telephony sample rate
              patientName: 'Patient'
            });
            
            console.log(`Agent response for media stream in room ${roomName}: "${response.text}"`);
            
            // Send text response back to websocket client (for debugging)
            ws.send(JSON.stringify({
              text: response.text,
              timestamp: new Date().toISOString()
            }));
            
          } catch (error) {
            handleProcessingError(error);
          }
        }, 500); // Short delay to collect any additional packets
      }
    } catch (error) {
      handleProcessingError(error);
    }
  });
  
  ws.on('close', () => {
    console.log(`Twilio media stream for room ${roomName} closed after ${packetsReceived} packets`);
    if (processingTimeout) {
      clearTimeout(processingTimeout);
    }
  });
});

// ================ DEEPGRAM AUDIO PROCESSING ================

// ================ DEEPGRAM INTEGRATION (VIA LIVEKIT) ================
// NOTE: These endpoints are maintained for backward compatibility during transition.
// In the new architecture, LiveKit handles the Deepgram integration directly.

// Handle audio for speech-to-text (batch processing)
app.post('/audio/transcribe', async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Audio data is required' });
    }
    
    const audioData = req.body;
    const mimetype = req.headers['content-type'] || 'audio/webm';
    const language = req.query.language || 'en-US';
    
    // Note: In the new architecture, transcription happens through LiveKit's integration
    // with Deepgram. This endpoint is kept for backward compatibility.
    console.log('DEPRECATED: Using direct Deepgram integration. ' +
                'Speech-to-text should be handled by LiveKit\'s Deepgram integration.');
    
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
    
    // Note: In the new architecture, text-to-speech happens through LiveKit's integration
    // with Deepgram. This endpoint is kept for backward compatibility.
    console.log('DEPRECATED: Using direct Deepgram integration. ' +
                'Text-to-speech should be handled by LiveKit\'s Deepgram integration.');
    
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
    
    // Log audio processing attempt for debugging
    console.log(`Processing audio for room ${roomName}: ${audioData.length} bytes, type: ${mimetype}`);
    
    // Determine if this is likely telephony audio
    const isTelephonyAudio = mimetype.includes('mulaw') ||
                          mimetype.includes('pcm') ||
                          mimetype.includes('x-') ||
                          req.query.source === 'sip' ||
                          req.query.source === 'phone';
    
    // Process audio with AI agent
    const response = await livekitAgentManager.processPatientAudio(roomName, audioData, {
      mimetype,
      patientName: req.query.patientName,
      source: isTelephonyAudio ? 'phone' : 'web',
      telephony: isTelephonyAudio
    });
    
    console.log(`Agent response for room ${roomName}: "${response.text}"`);
    
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