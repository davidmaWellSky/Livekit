const { RoomServiceClient, Room, AccessToken } = require('livekit-server-sdk');
const AIAgent = require('./ai-agent');
const deepgramService = require('./deepgram.service');
const twilioService = require('./twilio.service');

class LiveKitAgentManager {
  constructor() {
    // LiveKit configuration
    this.livekitHost = process.env.LIVEKIT_HOST || 'localhost:7880';
    this.livekitApiKey = process.env.LIVEKIT_API_KEY || 'devkey';
    this.livekitApiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
    
    // Create a Room Service Client
    this.roomService = new RoomServiceClient(
      `http://${this.livekitHost}`,
      this.livekitApiKey,
      this.livekitApiSecret
    );
    
    // Track active AI agent instances and calls
    this.activeAgents = new Map(); // roomName -> AIAgent instance
    this.activeCalls = new Map(); // roomName -> call details
    
    console.log('LiveKit Agent Manager initialized');
  }
  
  /**
   * Initiate an outbound call to a patient via Twilio
   * @param {string} roomName - LiveKit room name
   * @param {string} phoneNumber - Patient phone number
   * @param {Object} options - Additional call options
   * @returns {Promise<Object>} - Call details
   */
  async callPatient(roomName, phoneNumber, options = {}) {
    try {
      // Check if room exists, create if not
      await this.ensureRoomExists(roomName);
      
      // Ensure AI agent is ready
      await this.createAgentForRoom(roomName);
      
      // Generate initial greeting message
      const initialMessage = options.initialMessage ||
        "Hello, this is your healthcare scheduling assistant calling. How can I help you today?";
      
      // Make the Twilio call
      const callDetails = await twilioService.makeCall(phoneNumber, {
        roomName,
        message: initialMessage,
        baseUrl: options.baseUrl || `http://${options.hostname || 'localhost'}:${process.env.PORT || 3001}`,
        record: options.record || false
      });
      
      // Store call details with the SID as the participant ID
      // This allows us to hang up the call even if the participant doesn't properly join the room
      this.activeCalls.set(roomName, {
        sid: callDetails.sid,
        phoneNumber,
        status: callDetails.status,
        startTime: new Date(),
        participantId: callDetails.sid, // Use call SID as participant ID for direct hangup
        agentId: this.activeAgents.get(roomName)?.agent.getIdentity().id
      });
      
      console.log(`Outbound call initiated to ${phoneNumber} for room ${roomName}`);
      return {
        callSid: callDetails.sid,
        roomName,
        status: callDetails.status,
        callParticipantId: callDetails.sid, // Include the SID as participant ID for the frontend
        agentId: this.activeAgents.get(roomName)?.agent.getIdentity().id
      };
    } catch (error) {
      console.error(`Error initiating call to ${phoneNumber} for room ${roomName}:`, error);
      throw error;
    }
  }
  
  /**
   * End an active call
   * @param {string} roomName - LiveKit room name
   * @returns {Promise<boolean>} - Success status
   */
  async endCall(roomName) {
    try {
      const callDetails = this.activeCalls.get(roomName);
      if (!callDetails) {
        console.warn(`No active call found for room ${roomName}`);
        return false;
      }
      
      console.log(`Ending call with SID: ${callDetails.sid} for room ${roomName}`);
      
      // End the Twilio call using the stored SID
      await twilioService.endCall(callDetails.sid);
      
      // Remove from active calls
      this.activeCalls.delete(roomName);
      
      console.log(`Call ended for room ${roomName}`);
      return {
        success: true,
        callSid: callDetails.sid
      };
    } catch (error) {
      console.error(`Error ending call for room ${roomName}:`, error);
      throw error;
    }
  }

  // Create and add an AI agent to a room
  async createAgentForRoom(roomName) {
    try {
      // Check if room exists, create if not
      await this.ensureRoomExists(roomName);
      
      // Check if agent already exists for this room
      if (this.activeAgents.has(roomName)) {
        console.log(`AI Agent already exists in room ${roomName}`);
        return this.activeAgents.get(roomName);
      }
      
      // Create a new AI agent
      const aiAgent = new AIAgent();
      const { id: agentId, name: agentName } = aiAgent.getIdentity();
      
      // Create token for AI agent
      const token = this.createToken(agentId, roomName);
      
      // Store AI agent
      this.activeAgents.set(roomName, {
        agent: aiAgent,
        roomName,
        token
      });
      
      console.log(`AI Agent "${agentName}" (${agentId}) created for room ${roomName}`);
      
      // In a complete implementation, we would connect the agent to the room
      // and set up audio processing here
      
      return {
        agentId,
        agentName,
        roomName
      };
    } catch (error) {
      console.error(`Error creating AI agent for room ${roomName}:`, error);
      throw error;
    }
  }
  
  // Create an access token for the agent
  createToken(identity, roomName) {
    const at = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
      identity,
      ttl: 3600 * 24, // 24 hours
    });
    
    at.addGrant({ roomJoin: true, room: roomName });
    
    return at.toJwt();
  }
  
  // Ensure a room exists
  async ensureRoomExists(roomName) {
    try {
      const rooms = await this.roomService.listRooms();
      const roomExists = rooms.some(room => room.name === roomName);
      
      if (!roomExists) {
        await this.roomService.createRoom({
          name: roomName,
          emptyTimeout: 60 * 60, // 1 hour
          maxParticipants: 10
        });
        console.log(`Created room ${roomName}`);
      }
    } catch (error) {
      console.error(`Error ensuring room ${roomName} exists:`, error);
      throw error;
    }
  }
  
  // Get agent for a specific room
  getAgentForRoom(roomName) {
    return this.activeAgents.get(roomName);
  }
  
  /**
   * Process incoming message from a patient
   * @param {string} roomName - LiveKit room name
   * @param {string} message - Text message from patient
   * @param {string} patientName - Patient name or identifier
   * @returns {Promise<Object>} - Agent response with text and audio
   */
  async processPatientMessage(roomName, message, patientName = 'Patient') {
    try {
      const agentData = this.activeAgents.get(roomName);
      
      if (!agentData) {
        throw new Error(`No AI agent found for room ${roomName}`);
      }
      
      // Process message with AI agent and get response with audio
      const response = await agentData.agent.processMessage(message, patientName);
      
      console.log(`Processed message from ${patientName} in room ${roomName}`);
      
      // In a complete implementation, we would stream the audio response
      // through LiveKit to the patient
      return response;
    } catch (error) {
      console.error(`Error processing patient message in room ${roomName}:`, error);
      throw error;
    }
  }
  
  /**
   * Process audio from a patient
   * @param {string} roomName - LiveKit room name
   * @param {Buffer} audioData - Audio data from patient
   * @param {Object} options - Audio processing options
   * @returns {Promise<Object>} - Agent response with text and audio
   */
  async processPatientAudio(roomName, audioData, options = {}) {
    try {
      const agentData = this.activeAgents.get(roomName);
      
      if (!agentData) {
        throw new Error(`No AI agent found for room ${roomName}`);
      }
      
      // Process audio with AI agent
      const response = await agentData.agent.processAudio(audioData, {
        patientName: options.patientName || 'Patient',
        ...options
      });
      
      console.log(`Processed audio from patient in room ${roomName}`);
      
      // In a complete implementation, we would stream the audio response
      // through LiveKit to the patient
      return response;
    } catch (error) {
      console.error(`Error processing patient audio in room ${roomName}:`, error);
      throw error;
    }
  }
  
  // Remove agent from a room
  removeAgentFromRoom(roomName) {
    if (this.activeAgents.has(roomName)) {
      this.activeAgents.delete(roomName);
      console.log(`Removed AI agent from room ${roomName}`);
      return true;
    }
    return false;
  }
}

module.exports = new LiveKitAgentManager();