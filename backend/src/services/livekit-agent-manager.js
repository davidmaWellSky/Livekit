const { RoomServiceClient, Room, AccessToken } = require('livekit-server-sdk');
const AIAgent = require('./ai-agent');

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
    
    // Track active AI agent instances
    this.activeAgents = new Map(); // roomName -> AIAgent instance
    
    // Speech recognition and synthesis would be integrated here in a production system
    console.log('LiveKit Agent Manager initialized');
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
  
  // Process incoming message from a patient
  async processPatientMessage(roomName, message, patientName = 'Patient') {
    try {
      const agentData = this.activeAgents.get(roomName);
      
      if (!agentData) {
        throw new Error(`No AI agent found for room ${roomName}`);
      }
      
      const response = await agentData.agent.processMessage(message, patientName);
      
      // In a complete implementation, we would convert this response to speech
      // and send it through LiveKit to the patient
      
      return response;
    } catch (error) {
      console.error(`Error processing patient message in room ${roomName}:`, error);
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