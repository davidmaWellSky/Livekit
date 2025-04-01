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
    
    // Track call status polling (for cases where webhook isn't received)
    this.callStatusPolling = new Map(); // callSid -> interval ID
    
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
      // Validate phone number
      if (!phoneNumber || phoneNumber.trim() === '') {
        throw new Error('Phone number is required to make a call');
      }
      
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
        agentId: this.activeAgents.get(roomName)?.agent.getIdentity().id,
        connected: false, // Track if the participant has successfully connected
        lastStatusUpdate: new Date()
      });
      
      // Start polling for call status as a fallback for webhook
      this.startCallStatusPolling(roomName, callDetails.sid);
      
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
      
      let success = true;
      
      try {
        // Try to end the Twilio call
        await twilioService.endCall(callDetails.sid);
      } catch (twilioError) {
        console.warn(`Error ending Twilio call: ${twilioError.message}. The call may have already ended.`);
        success = false;
      }
      
      // Always mark the call as ended in our system
      await this.markCallEnded(roomName, callDetails.sid);
      
      console.log(`Call marked as ended for room ${roomName}`);
      return {
        success: true,
        callSid: callDetails.sid,
        endedByUser: true
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
  
  /**
   * Get a list of all rooms with active calls
   * @returns {Array<string>} Array of room names that have active calls
   */
  getRoomsWithActiveCalls() {
    return Array.from(this.activeCalls.keys());
  }
  
  /**
   * Get call details for a specific room
   * @param {string} roomName - The room name
   * @returns {Object|null} Call details or null if no active call
   */
  getCallDetails(roomName) {
    return this.activeCalls.get(roomName) || null;
  }
  
  /**
   * Mark a call as ended without trying to end it via Twilio
   * @param {string} roomName - The room name
   * @param {string} callSid - The Twilio call SID
   */
  async markCallEnded(roomName, callSid) {
    try {
      console.log(`Marking call ${callSid} in room ${roomName} as ended`);
      
      // Clear any polling interval
      if (this.callStatusPolling.has(callSid)) {
        clearInterval(this.callStatusPolling.get(callSid));
        this.callStatusPolling.delete(callSid);
      }
      
      // Also check for any alternate polling intervals that might have been set up
      Array.from(this.callStatusPolling.entries()).forEach(([key, value]) => {
        if (key.includes(roomName)) {
          clearInterval(value);
          this.callStatusPolling.delete(key);
        }
      });
      
      // Remove from active calls
      this.activeCalls.delete(roomName);
      
      return {
        success: true,
        ended: true,
        callSid
      };
    } catch (error) {
      console.error(`Error marking call as ended for room ${roomName}:`, error);
      throw error;
    }
  }
  
  /**
   * Poll for call status updates as a fallback
   * @param {string} roomName - The room name
   * @param {string} callSid - The Twilio call SID
   */
  startCallStatusPolling(roomName, callSid) {
    // Check if already polling
    if (this.callStatusPolling.has(callSid)) {
      return;
    }
    
    console.log(`Starting call status polling for ${callSid} in room ${roomName}`);
    
    // Poll more frequently initially to catch quick transitions, then slower
    let pollCount = 0;
    const intervalId = setInterval(async () => {
      try {
        pollCount++;
        
        // Get current call info from Twilio
        const callInfo = await twilioService.getCallInfo(callSid);
        console.log(`Poll ${pollCount}: Call ${callSid} status: ${callInfo.status} in room ${roomName}`);
        
        // Get our stored call info
        const storedCallInfo = this.activeCalls.get(roomName);
        
        // If we have stored call info, update the status
        if (storedCallInfo) {
          // Update the stored call status
          storedCallInfo.status = callInfo.status;
          storedCallInfo.lastStatusUpdate = new Date();
          
          // If call became 'in-progress', update our connected flag
          if (callInfo.status === 'in-progress' && !storedCallInfo.connected) {
            console.log(`Call ${callSid} is now in-progress in room ${roomName}`);
            storedCallInfo.connected = true;
          }
          
          // Update the stored call info
          this.activeCalls.set(roomName, storedCallInfo);
        }
        
        // Check if call is complete for any termination statuses
        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callInfo.status)) {
          console.log(`Poll detected call ${callSid} has ended with status: ${callInfo.status}`);
          await this.markCallEnded(roomName, callSid);
        }
        
        // After 10 polls, increase the polling interval to 30 seconds
        if (pollCount === 10) {
          console.log(`Reducing polling frequency for call ${callSid} after 10 polls`);
          clearInterval(intervalId);
          
          const newIntervalId = setInterval(async () => {
            try {
              const laterCallInfo = await twilioService.getCallInfo(callSid);
              console.log(`Extended poll: Call ${callSid} status: ${laterCallInfo.status}`);
              
              if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(laterCallInfo.status)) {
                console.log(`Extended poll detected call ${callSid} has ended`);
                await this.markCallEnded(roomName, callSid);
              }
            } catch (error) {
              console.error(`Error in extended polling for ${callSid}:`, error);
              if (error.status === 404) {
                console.log(`Call ${callSid} not found in extended poll, ending`);
                await this.markCallEnded(roomName, callSid);
              }
            }
          }, 30000); // Every 30 seconds
          
          this.callStatusPolling.set(`${callSid}-extended`, newIntervalId);
        }
      } catch (error) {
        // If we can't get the call info, it probably doesn't exist anymore
        console.error(`Error polling call status for ${callSid}:`, error);
        if (error.status === 404) {
          console.log(`Call ${callSid} not found, assuming it has ended`);
          await this.markCallEnded(roomName, callSid);
        }
      }
    }, 5000); // Every 5 seconds initially
    
    this.callStatusPolling.set(callSid, intervalId);
  }
}

module.exports = new LiveKitAgentManager();