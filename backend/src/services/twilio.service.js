const twilio = require('twilio');

class TwilioService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!this.accountSid || !this.authToken || !this.twilioPhoneNumber) {
      console.warn('Twilio credentials are not properly configured. Outbound calls will be disabled.');
      return;
    }
    
    try {
      // Initialize Twilio client
      this.client = twilio(this.accountSid, this.authToken);
      console.log('Twilio service initialized with phone number:', this.twilioPhoneNumber);
    } catch (error) {
      console.error('Failed to initialize Twilio client:', error);
    }
  }
  
  /**
   * Make an outbound call to a phone number
   * @param {string} to - The phone number to call (E.164 format)
   * @param {Object} options - Call options
   * @returns {Promise<Object>} - The call details
   */
  async makeCall(to, options = {}) {
    if (!this.client) {
      throw new Error('Twilio client is not initialized');
    }
    
    try {
      // Normalize phone number to E.164 format if not already
      const toNumber = this.normalizePhoneNumber(to);
      
      // Default callback URL that will connect the call to the LiveKit room
      // Since Twilio cannot reach our local server, we'll use TwiML directly
      // instead of providing a URL for Twilio to fetch TwiML instructions
      
      // Create call with inline TwiML, not using a callback URL
      const twiml = this.generateConnectTwiml(options.message, options.roomName);
      
      console.log("Using TwiML directly:", twiml);
      
      // Create the call with the TwiML inline
      const call = await this.client.calls.create({
        to: toNumber,
        from: this.twilioPhoneNumber,
        twiml: twiml,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: options.record || false
      });
      
      console.log(`Call initiated to ${toNumber} with SID: ${call.sid}`);
      return {
        sid: call.sid,
        to: toNumber,
        from: this.twilioPhoneNumber,
        status: call.status,
        dateCreated: call.dateCreated
      };
    } catch (error) {
      console.error(`Error making call to ${to}:`, error);
      throw error;
    }
  }
  
  /**
   * Generate default TwiML for a call
   * @param {string} message - The message to say
   * @returns {string} - TwiML markup
   */
  generateDefaultTwiml(message = 'Hello, this is an automated call from our appointment scheduling system. Please hold while we connect you to our scheduling agent.') {
    return `
      <Response>
        <Say voice="alice">${message}</Say>
        <Pause length="1"/>
        <Say voice="alice">Connecting you now.</Say>
      </Response>
    `;
  }
  
  /**
   * Generate TwiML for connecting to a LiveKit room via SIP
   * @param {string} message - Initial greeting message
   * @param {string} roomName - The LiveKit room name
   * @returns {string} - TwiML markup
   */
  generateConnectTwiml(message = 'Hello, this is your healthcare scheduling assistant calling. How can I help you today?', roomName) {
    // Check if we have SIP trunk information
    const hasSipInfo = process.env.TWILIO_TRUNK_SID &&
                       process.env.TWILIO_TERMINATION_URI &&
                       process.env.TWILIO_CREDENTIAL_LIST_USERNAME &&
                       process.env.TWILIO_CREDENTIAL_LIST_PASSWORD;
    
    // If we have SIP info, try to connect via SIP to LiveKit
    if (hasSipInfo) {
      console.log('Generating TwiML with SIP connection to LiveKit room:', roomName);
      return `
        <Response>
          <Say voice="alice">${message}</Say>
          <Pause length="1"/>
          <Say voice="alice">Connecting you to your appointment scheduling assistant now.</Say>
          <Dial timeout="60" timeLimit="1800" ringTone="us" record="record-from-answer">
            <Sip username="${process.env.TWILIO_CREDENTIAL_LIST_USERNAME}"
                 password="${process.env.TWILIO_CREDENTIAL_LIST_PASSWORD}"
                 statusCallbackEvent="initiated ringing answered completed"
                 mediaStreamingEnabled="true"
                 mediaStreamingTrack="both">
                sip:${roomName}@${process.env.TWILIO_TERMINATION_URI}
            </Sip>
          </Dial>
          <Say voice="alice">Thank you for using our service. Goodbye.</Say>
        </Response>
      `;
    }
    
    // If we don't have SIP info, just provide a standard conversation
    return `
      <Response>
        <Say voice="alice">${message}</Say>
        <Pause length="1"/>
        <Say voice="alice">
          I'm sorry, but we're experiencing technical difficulties connecting you to the scheduling system.
          Please try again later or call our main office directly. Thank you for your patience.
        </Say>
        <Pause length="1"/>
        <Record timeout="5" maxLength="60" playBeep="false" />
        <Say voice="alice">Thank you for your message. Goodbye.</Say>
        <Hangup />
      </Response>
    `;
  }
  
  /**
   * Normalize a phone number to E.164 format
   * @param {string} phoneNumber - The phone number to normalize
   * @returns {string} - E.164 formatted phone number
   */
  normalizePhoneNumber(phoneNumber) {
    // Basic normalization - remove spaces, dashes, parentheses
    let normalized = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // If it doesn't start with +, assume US/Canada number (add +1)
    if (!normalized.startsWith('+')) {
      // If it starts with 1, add +
      if (normalized.startsWith('1')) {
        normalized = `+${normalized}`;
      } else {
        // Otherwise add +1
        normalized = `+1${normalized}`;
      }
    }
    
    return normalized;
  }
  
  /**
   * Update a call in progress
   * @param {string} callSid - The SID of the call to update
   * @param {Object} options - Options for updating the call
   * @returns {Promise<Object>} - Updated call details
   */
  async updateCall(callSid, options = {}) {
    if (!this.client) {
      throw new Error('Twilio client is not initialized');
    }
    
    try {
      // Update the call
      const updatedCall = await this.client.calls(callSid).update({
        twiml: options.twiml,
        ...(options.url ? { url: options.url } : {})
      });
      
      console.log(`Call ${callSid} updated`);
      return {
        sid: updatedCall.sid,
        status: updatedCall.status,
        dateUpdated: updatedCall.dateUpdated
      };
    } catch (error) {
      console.error(`Error updating call ${callSid}:`, error);
      throw error;
    }
  }
  
  /**
   * End a call in progress
   * @param {string} callSid - The SID of the call to end
   * @returns {Promise<Object>} - Call status after ending
   */
  async endCall(callSid) {
    if (!this.client) {
      throw new Error('Twilio client is not initialized');
    }
    
    try {
      // Update the call with a hangup TwiML
      const updatedCall = await this.client.calls(callSid).update({
        twiml: '<Response><Hangup/></Response>'
      });
      
      console.log(`Call ${callSid} ended`);
      return {
        sid: updatedCall.sid,
        status: updatedCall.status,
        dateUpdated: updatedCall.dateUpdated
      };
    } catch (error) {
      console.error(`Error ending call ${callSid}:`, error);
      throw error;
    }
  }
  
  /**
   * Get information about a call
   * @param {string} callSid - The SID of the call
   * @returns {Promise<Object>} - Call details
   */
  async getCallInfo(callSid) {
    if (!this.client) {
      throw new Error('Twilio client is not initialized');
    }
    
    try {
      const call = await this.client.calls(callSid).fetch();
      return call;
    } catch (error) {
      console.error(`Error getting call info for ${callSid}:`, error);
      throw error;
    }
  }
}

module.exports = new TwilioService();