const { Deepgram } = require('@deepgram/sdk');
const { PassThrough } = require('stream');
const nodeFetch = require('node-fetch');

class DeepgramService {
  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY;
    // Using the port-forwarded Deepgram instance in Kubernetes
    this.deepgramUrl = process.env.DEEPGRAM_URL || 'http://localhost:9012';
    
    // Check if API key is missing or is just a placeholder
    if (!this.apiKey || this.apiKey === 'YOUR_DEEPGRAM_API_KEY') {
      console.warn('DEEPGRAM_API_KEY is not properly set. Speech-to-text functionality will use mock responses for development.');
      this.useMockResponses = true;
    } else {
      this.useMockResponses = false;
    }
    
    // For port-forwarded instance, we'll access it directly via HTTP rather than using the SDK
    // to avoid any SDK version compatibility issues
    this.deepgram = null;
    
    // Setup mock data for development/testing
    this.setupMockResponses();
    
    console.log(`Deepgram service initialized using port-forwarded instance at: ${this.deepgramUrl}`);
    console.log(`Deepgram mode: ${this.useMockResponses ? 'MOCK' : 'LIVE'}`);
  }
  
  /**
   * Setup mock responses for development without a real Deepgram instance
   */
  setupMockResponses() {
    this.mockTranscriptions = [
      "I'd like to schedule an appointment with Dr. Smith for next week.",
      "I need to see a doctor about my chronic back pain.",
      "Do you have any availability on Thursday afternoon?",
      "My name is John Doe and my phone number is 555-123-4567.",
      "Yes, Tuesday at 2pm works perfectly for me."
    ];
    
    this.mockAudioBuffer = Buffer.from('Mock audio data for development');
  }
  
  /**
   * Convert speech to text using Deepgram
   * @param {AudioBuffer|Buffer} audioData - The audio data to transcribe
   * @param {Object} options - Options for transcription
   * @returns {Promise<string>} - The transcribed text
   */
  /**
   * Convert speech to text using Deepgram
   * @param {AudioBuffer|Buffer} audioData - The audio data to transcribe
   * @param {Object} options - Options for transcription
   * @returns {Promise<string>} - The transcribed text
   */
  async speechToText(audioData, options = {}) {
    try {
      // Log audio data details for debugging
      console.log(`Received audio data: ${audioData.length} bytes, mimetype: ${options.mimetype || 'unknown'}`);
      
      // If we're in mock mode, return a mock transcription
      if (this.useMockResponses) {
        const randomIndex = Math.floor(Math.random() * this.mockTranscriptions.length);
        const mockTranscript = this.mockTranscriptions[randomIndex];
        console.log(`Using mock transcription: "${mockTranscript}"`);
        
        // Add a slight delay to simulate processing time
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return mockTranscript;
      }
      
      // Real implementation for when Deepgram is available
      const nodeFetch = require('node-fetch');
      const fetchFunc = globalThis.fetch || nodeFetch;
      
      // Set up transcription options
      const transcriptionOptions = {
        punctuate: true,
        model: options.model || 'general',
        language: options.language || 'en-US',
        tier: options.tier || 'enhanced',
        ...options
      };
      
      // Convert options to query string parameters
      const queryParams = new URLSearchParams();
      Object.entries(transcriptionOptions).forEach(([key, value]) => {
        if (typeof value === 'boolean') {
          queryParams.append(key, value ? 'true' : 'false');
        } else if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString());
        }
      });
      
      // Special handling for telephony audio if detected
      if (options.source === 'phone' || options.source === 'sip' ||
          (options.mimetype && options.mimetype.includes('audio/x-')) ||
          (options.mimetype && options.mimetype.includes('mulaw'))) {
        // Telephony audio detected
        console.log('Detected telephony audio source, adjusting transcription parameters');
        queryParams.append('detect_language', 'true');
        queryParams.append('channels', '1');
        queryParams.append('sample_rate', '8000'); // Common for telephony
      }
      
      console.log(`Sending transcription request to: ${this.deepgramUrl}/v1/listen`);
      
      // Send audio data to port-forwarded Deepgram instance
      const response = await fetchFunc(`${this.deepgramUrl}/v1/listen?${queryParams.toString()}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': options.mimetype || 'audio/webm'
        },
        body: audioData,
        timeout: 15000 // Extended timeout for telephony audio
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
      }
      
      const result = await response.json();
      console.log('Deepgram response received:', JSON.stringify(result, null, 2));
      
      const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      console.log(`Transcription result: "${transcript}"`);
      return transcript;
    } catch (error) {
      console.error('Error transcribing speech:', error);
      
      // If real transcription fails, fall back to mock in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('Falling back to mock transcription after error');
        const randomIndex = Math.floor(Math.random() * this.mockTranscriptions.length);
        return this.mockTranscriptions[randomIndex];
      }
      
      throw error;
    }
  }
  
  /**
   * Create a real-time speech recognition stream
   * @param {Object} options - Options for the stream
   * @returns {Object} - Object with stream and methods to handle transcription
   */
  createLiveTranscriptionStream(options = {}) {
    if (!this.deepgram) {
      throw new Error('Deepgram client is not initialized');
    }
    
    try {
      // Setup options for v3 API
      const deepgramOptions = {
        punctuate: true,
        model: options.model || 'general',
        language: options.language || 'en-US',
        tier: options.tier || 'enhanced',
        interim_results: !!options.interimResults,
        ...options
      };
      
      // Create a live transcription
      const deepgramLive = this.deepgram.listen.live(deepgramOptions);
      
      // Create a PassThrough stream for sending audio data
      const audioStream = new PassThrough();
      
      // Track callbacks
      const callbacks = {
        onTranscript: [],
        onError: [],
        onClose: []
      };
      
      // Set up event listeners for v3 API
      deepgramLive.addListener('transcriptReceived', (transcript) => {
        for (const callback of callbacks.onTranscript) {
          callback(transcript);
        }
      });
      
      deepgramLive.addListener('error', (error) => {
        for (const callback of callbacks.onError) {
          callback(error);
        }
      });
      
      deepgramLive.addListener('close', () => {
        for (const callback of callbacks.onClose) {
          callback();
        }
      });
      
      // Connect the audio stream to Deepgram
      audioStream.on('data', (chunk) => {
        deepgramLive.send(chunk);
      });
      
      // Return object with methods to interact with the stream
      return {
        send: (data) => audioStream.write(data),
        close: () => {
          audioStream.end();
          deepgramLive.finish();
        },
        onTranscript: (callback) => callbacks.onTranscript.push(callback),
        onError: (callback) => callbacks.onError.push(callback),
        onClose: (callback) => callbacks.onClose.push(callback)
      };
    } catch (error) {
      console.error('Error creating transcription stream:', error);
      throw error;
    }
  }
  
  /**
   * Convert text to speech using Deepgram (assuming TTS endpoint)
   * @param {string} text - The text to convert to speech
   * @param {Object} options - Options for speech synthesis
   * @returns {Promise<Buffer>} - The audio data
   */
  async textToSpeech(text, options = {}) {
    try {
      // If we're in mock mode, return a mock audio buffer
      if (this.useMockResponses) {
        console.log(`Using mock TTS for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        // Add a slight delay to simulate processing time
        await new Promise(resolve => setTimeout(resolve, 700));
        
        return this.mockAudioBuffer;
      }
      
      const nodeFetch = require('node-fetch');
      const fetchFunc = globalThis.fetch || nodeFetch;
      
      console.log(`Sending TTS request to: ${this.deepgramUrl}/v1/speak`);
      
      // Prepare request to port-forwarded Deepgram TTS API
      const response = await fetchFunc(`${this.deepgramUrl}/v1/speak`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: options.voice || 'female-1',
          model: options.model || 'aura-asteria-en',
          encoding: options.encoding || 'LINEAR16',
          sample_rate: options.sampleRate || 16000,
          ...options
        }),
        timeout: 10000 // 10 second timeout
      });
      
      if (!response.ok) {
        console.error(`TTS Error: ${await response.text()}`);
        throw new Error(`HTTP error ${response.status} from port-forwarded Deepgram instance`);
      }
      
      // Get audio data as buffer
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      console.error('Error synthesizing speech:', error);
      
      // If real TTS fails, fall back to mock in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('Falling back to mock audio data after TTS error');
        return this.mockAudioBuffer;
      }
      
      throw error;
    }
  }
}

module.exports = new DeepgramService();