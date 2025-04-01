const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');

class AIAgent {
  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for AI Agent');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.agentName = 'GeminiAgent';
    this.agentId = `ai-agent-${uuidv4()}`;
    this.chatHistory = [];
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
    
    this.setupAgentPersonality();
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
    
    Speak naturally as if you're on a phone call, not text. Remember patients are talking to you through their phone.`;
    
    // Add system prompt to chat history
    this.chatHistory.push({ role: 'system', parts: [{ text: systemPrompt }] });
  }

  async processMessage(message, patientName = 'Patient') {
    try {
      console.log(`Processing message from ${patientName}: ${message}`);
      
      // Add user message to chat history
      this.chatHistory.push({ role: 'user', parts: [{ text: message }] });
      
      // Get response from Gemini
      const result = await this.chat.sendMessage(message);
      const response = result.response;
      const responseText = response.text();
      
      // Add AI response to chat history
      this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
      
      console.log(`AI Agent response: ${responseText}`);
      return responseText;
    } catch (error) {
      console.error('AI Agent error:', error);
      return "I'm sorry, I'm having trouble processing your request right now. Could you please repeat that?";
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