const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const deepgramService = require('./deepgram.service');

class AIAgent {
  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      console.warn('GEMINI_API_KEY is not properly set. Using mock responses for AI Agent.');
      this.useMockResponses = true;
    } else {
      this.useMockResponses = false;
    }
    
    this.agentName = 'GeminiAgent';
    this.agentId = `ai-agent-${uuidv4()}`;
    this.chatHistory = [];
    
    if (!this.useMockResponses) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
        this.chat = this.model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
          },
        });
        console.log('Gemini AI model initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Gemini AI:', error);
        this.useMockResponses = true;
      }
    }
    
    this.setupAgentPersonality();
    
    // Mock responses for testing when API key is not available
    this.mockResponses = [
      "I can schedule an appointment for you. What day works best for you?",
      "We have openings on Monday at 10am, Tuesday at 2pm, or Wednesday at 3pm. Would any of those work for you?",
      "Great! I've scheduled your appointment for Tuesday at 2pm. Can I help with anything else?",
      "Could you please provide your full name and phone number for our records?",
      "Thank you. Your appointment is confirmed. You'll receive a confirmation text shortly."
    ];
    this.currentMockResponseIndex = 0;
    
    // Speech settings
    this.speechSettings = {
      voice: 'female-1',
      language: 'en-US'
    };
  }

  setupAgentPersonality() {
    // Initial prompt to define the AI agent's personality and role
    const systemPrompt = `You are a healthcare scheduling assistant named ${this.agentName}. 
    Your primary role is to help patients schedule medical appointments in a friendly, professional manner.
    
    Guidelines:
    - Be warm and empathetic with patients
    - Keep responses brief and conversational (1-3 sentences)
    - Collect necessary information: patient name, reason for visit, preferred dates/times
    - Suggest available appointment slots
    - Confirm appointment details before finalizing
    - Avoid medical advice - focus only on scheduling
    - If patient has medical questions, politely redirect to healthcare professionals
    
    Speak naturally as if you're on a phone call, not text. Remember patients are talking to you through their phone.
    
    For appointment scheduling, please:
    1. Gather the patient's name, phone number, and reason for visit
    2. Suggest available slots (you can make these up for testing)
    3. Confirm appointment details clearly before finalizing
    
    Keep your responses concise and clear since they will be converted to speech.`;
    
    // Add system prompt to chat history
    this.chatHistory.push({ role: 'system', parts: [{ text: systemPrompt }] });
  }

  /**
   * Process text message from patient
   * @param {string} message - Text message from patient
   * @param {string} patientName - Patient name
   * @returns {Promise<{text: string, audio?: Buffer}>} - Agent response with text and optional audio
   */
  async processMessage(message, patientName = 'Patient') {
    try {
      console.log(`Processing message from ${patientName}: ${message}`);
      
      // Add user message to chat history
      this.chatHistory.push({ role: 'user', parts: [{ text: message }] });
      
      let responseText;
      
      // Use mock responses if API key is not available
      if (this.useMockResponses) {
        responseText = this.getNextMockResponse();
        console.log(`Using mock response: ${responseText}`);
      } else {
        // Get response from Gemini
        const result = await this.chat.sendMessage(message);
        const response = result.response;
        responseText = response.text();
      }
      
      // Add AI response to chat history
      this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
      
      // Generate speech from text
      let audioData = null;
      try {
        audioData = await this.generateSpeech(responseText);
      } catch (speechError) {
        console.error('Failed to generate speech:', speechError);
        // Continue without audio if speech generation fails
      }
      
      console.log(`AI Agent response: ${responseText}`);
      return {
        text: responseText,
        audio: audioData
      };
    } catch (error) {
      console.error('AI Agent error:', error);
      const fallbackResponse = "I'm sorry, I'm having trouble processing your request right now. Could you please repeat that?";
      
      // Try to generate speech for the fallback response
      let fallbackAudio = null;
      try {
        fallbackAudio = await this.generateSpeech(fallbackResponse);
      } catch (speechError) {
        console.error('Failed to generate fallback speech:', speechError);
      }
      
      return {
        text: fallbackResponse,
        audio: fallbackAudio
      };
    }
  }
  
  /**
   * Process audio input from patient
   * @param {Buffer} audioData - Audio data from patient
   * @param {Object} options - Audio processing options
   * @returns {Promise<{text: string, audio?: Buffer}>} - Agent response with text and optional audio
   */
  /**
   * Get the next mock response and cycle through available responses
   * @returns {string} - The next mock response
   */
  getNextMockResponse() {
    const response = this.mockResponses[this.currentMockResponseIndex];
    this.currentMockResponseIndex = (this.currentMockResponseIndex + 1) % this.mockResponses.length;
    return response;
  }

  /**
   * Process audio input from patient
   * @param {Buffer} audioData - Audio data from patient
   * @param {Object} options - Audio processing options
   * @returns {Promise<{text: string, audio?: Buffer}>} - Agent response with text and optional audio
   */
  async processAudio(audioData, options = {}) {
    try {
      let transcript;
      
      try {
        // Transcribe audio to text
        transcript = await deepgramService.speechToText(audioData, {
          mimetype: options.mimetype || 'audio/webm',
          language: options.language || this.speechSettings.language
        });
        
        console.log(`Transcribed audio: "${transcript}"`);
      } catch (transcriptionError) {
        console.error('Error transcribing audio:', transcriptionError);
        
        // If deepgram fails, use a mock transcription for development purposes
        transcript = "Mock transcription for testing purposes.";
        console.log(`Using mock transcription: "${transcript}"`);
      }
      
      if (!transcript || transcript.trim() === '') {
        return {
          text: "I couldn't hear anything. Could you please speak again?",
          audio: await this.generateSpeech("I couldn't hear anything. Could you please speak again?")
        };
      }
      
      // Process the transcribed text
      return await this.processMessage(transcript, options.patientName || 'Patient');
    } catch (error) {
      console.error('Error processing audio:', error);
      const errorResponse = "I'm having trouble understanding the audio. Could you please try again?";
      
      return {
        text: errorResponse,
        audio: await this.generateSpeech(errorResponse)
      };
    }
  }
  
  /**
   * Generate speech from text
   * @param {string} text - Text to convert to speech
   * @returns {Promise<Buffer>} - Audio data
   */
  async generateSpeech(text) {
    try {
      // If we're using mock responses, don't attempt to generate speech
      if (this.useMockResponses) {
        console.warn('Using mock mode, skipping speech generation');
        return null;
      }
      
      // Check if Deepgram API key is set to a placeholder
      if (process.env.DEEPGRAM_API_KEY === 'YOUR_DEEPGRAM_API_KEY') {
        console.warn('Skipping speech generation: DEEPGRAM_API_KEY not configured');
        return null;
      }
      
      return await deepgramService.textToSpeech(text, this.speechSettings);
    } catch (error) {
      console.error('Error generating speech:', error);
      // Return null instead of throwing, to gracefully degrade to text-only
      return null;
    }
  }

  // Get agent identity information
  getIdentity() {
    return {
      id: this.agentId,
      name: this.agentName
    };
  }
}

module.exports = AIAgent;