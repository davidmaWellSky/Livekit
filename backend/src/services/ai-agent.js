const { v4: uuidv4 } = require('uuid');
const deepgramService = require('./deepgram.service');

/**
 * AI Agent class that represents a virtual agent in a LiveKit room
 * This implementation will leverage LiveKit's built-in Deepgram integration
 */
class AIAgent {
  constructor() {
    // Generate a unique ID and name for this agent
    this.id = `agent-${uuidv4().substring(0, 8)}`;
    this.name = 'HealthcareAgent';
    
    // Track conversation history
    this.conversationHistory = [];
    
    console.log(`AI Agent created with ID: ${this.id} and name: ${this.name}`);
  }
  
  /**
   * Get agent identity information
   * @returns {Object} Identity info
   */
  getIdentity() {
    return {
      id: this.id,
      name: this.name
    };
  }
  
  /**
   * Process a text message from a patient
   * This will now act as a pass-through since LiveKit will handle Deepgram interactions
   * @param {string} message - Text message from patient
   * @param {string} patientName - Patient name or identifier
   * @returns {Promise<Object>} - Agent response with text
   */
  async processMessage(message, patientName = 'Patient') {
    try {
      console.log(`Processing message from ${patientName}: "${message}"`);
      
      // Store message in conversation history
      this.conversationHistory.push({
        role: 'patient',
        name: patientName,
        content: message,
        timestamp: new Date().toISOString()
      });
      
      // Generate a simple response - in production, this would be handled by
      // LiveKit's agent capabilities or an external LLM
      let response = this.generateResponse(message);
      
      // Store agent response in conversation history
      this.conversationHistory.push({
        role: 'agent',
        name: this.name,
        content: response,
        timestamp: new Date().toISOString()
      });
      
      console.log(`Agent response: "${response}"`);
      
      return {
        text: response,
        agent: this.name,
        id: this.id
      };
    } catch (error) {
      console.error('Error processing message:', error);
      throw error;
    }
  }
  
  /**
   * Process audio from a patient
   * This method will be a pass-through as LiveKit now handles the ASR with Deepgram
   * @param {Buffer} audioData - Audio data from patient
   * @param {Object} options - Audio processing options
   * @returns {Promise<Object>} - Agent response with text and audio
   */
  async processAudio(audioData, options = {}) {
    try {
      console.log(`Processing audio from patient: ${audioData.length} bytes, mimetype: ${options.mimetype || 'unknown'}`);
      
      // NOTE: In the refactored architecture, LiveKit will handle the Deepgram integration
      // This method is kept for backward compatibility during transition
      
      // Check if this is telephony audio and ensure appropriate options are set
      const isTelephonyAudio =
        options.telephony ||
        options.source === 'phone' ||
        options.source === 'sip' ||
        (options.mimetype && (
          options.mimetype.includes('mulaw') ||
          options.mimetype.includes('pcm') ||
          options.mimetype.includes('x-')
        ));
      
      // In production, transcription should be handled by LiveKit's STT capabilities
      const transcript = await deepgramService.speechToText(audioData, {
        ...options,
        mimetype: options.mimetype || 'audio/webm',
        source: isTelephonyAudio ? 'phone' : options.source || 'web',
        // Force proper telephony settings if detected
        ...(isTelephonyAudio ? {
          channels: 1,
          sample_rate: options.sampleRate || 8000,
          encoding: 'mulaw'
        } : {})
      });
      
      console.log(`Transcript: "${transcript}"`);
      
      // Handle empty transcripts
      if (!transcript || transcript.trim() === '') {
        console.log('Empty transcript received, sending placeholder response');
        const placeholderResponse = {
          text: "I'm sorry, I couldn't hear you clearly. Could you please speak again?",
          audio: null,
          agent: this.name,
          id: this.id
        };
        
        // Generate audio for the placeholder response
        try {
          placeholderResponse.audio = await deepgramService.textToSpeech(placeholderResponse.text, {
            voice: 'female-1',
            language: 'en-US'
          });
        } catch (ttsError) {
          console.error('Error generating TTS for placeholder response:', ttsError);
        }
        
        return placeholderResponse;
      }
      
      // Process the transcript as a message
      const response = await this.processMessage(transcript, options.patientName || 'Patient');
      
      // In production, TTS should be handled by LiveKit's TTS capabilities
      // Here we keep it for backward compatibility
      let responseAudio = null;
      try {
        responseAudio = await deepgramService.textToSpeech(response.text, {
          voice: 'female-1',
          language: 'en-US'
        });
      } catch (ttsError) {
        console.error('Error generating TTS response:', ttsError);
      }
      
      return {
        text: response.text,
        audio: responseAudio,
        agent: this.name,
        id: this.id
      };
    } catch (error) {
      console.error('Error processing audio:', error);
      throw error;
    }
  }
  
  /**
   * Generate a simple response to a patient message
   * In production, this would be handled by a more sophisticated LLM or agent
   * @param {string} message - Patient message
   * @returns {string} - Agent response
   */
  generateResponse(message) {
    const lowercaseMessage = message.toLowerCase();
    
    // Simple pattern matching for demonstration
    if (lowercaseMessage.includes('appointment') && lowercaseMessage.includes('schedule')) {
      return "I'd be happy to help you schedule an appointment. What day and time would work best for you?";
    } else if (lowercaseMessage.includes('appointment') && lowercaseMessage.includes('cancel')) {
      return "I understand you want to cancel your appointment. To confirm, please let me know your name and the date of your appointment.";
    } else if (lowercaseMessage.includes('available') || lowercaseMessage.includes('availability')) {
      return "We have availability on Monday, Wednesday, and Friday afternoons next week. Would any of those days work for you?";
    } else if (lowercaseMessage.includes('confirm')) {
      return "I can confirm your appointment. Could you please verify your name and phone number for our records?";
    } else if (lowercaseMessage.includes('reschedule')) {
      return "I can help you reschedule your appointment. When would you like to reschedule it for?";
    } else if (lowercaseMessage.includes('thank')) {
      return "You're welcome! Is there anything else I can assist you with today?";
    } else if (lowercaseMessage.includes('goodbye') || lowercaseMessage.includes('bye')) {
      return "Thank you for contacting us. Have a great day!";
    } else {
      return "I'm your healthcare scheduling assistant. I can help you schedule, confirm, or reschedule appointments. How can I assist you today?";
    }
  }
}

module.exports = AIAgent;