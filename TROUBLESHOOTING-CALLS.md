# Troubleshooting Call Disconnection Issues

This document outlines the changes made to fix issues with calls disconnecting when patients start speaking, as well as suggestions for further troubleshooting.

## Problem Description

When a patient receives a call from the scheduling assistant:
1. The agent speaks a greeting message 
2. When the patient tries to respond, the call disconnects
3. The conversational aspect of the call doesn't work as expected

## Implemented Fixes

### 1. Enhanced Deepgram Configuration

Modified `livekit-sip-config.yaml` to improve speech recognition reliability:

```yaml
deepgram:
  url: http://host.docker.internal:9012
  api_key: ${DEEPGRAM_API_KEY}
  model: general
  tier: enhanced
  timeout_ms: 30000 # Increased timeout to 30 seconds
  fallback_provider: null # Disabled fallback to ensure consistent behavior
```

### 2. Improved Twilio SIP Connection

Updated `twilio.service.js` to enhance the SIP connection stability:

```javascript
<Dial timeout="120" timeLimit="3600" ringTone="us" record="record-from-answer" 
      action="https://${process.env.PUBLIC_HOSTNAME || 'localhost'}/twilio/dial-status"
      callerId="${this.twilioPhoneNumber}">
  <Sip username="${process.env.TWILIO_CREDENTIAL_LIST_USERNAME}"
       password="${process.env.TWILIO_CREDENTIAL_LIST_PASSWORD}"
       statusCallbackEvent="initiated ringing answered completed"
       statusCallback="https://${process.env.PUBLIC_HOSTNAME || 'localhost'}/twilio/sip-status"
       mediaStreamingEnabled="true"
       mediaStreamingTrack="both"
       mediaStreamingEndpoint="wss://${process.env.PUBLIC_HOSTNAME || 'localhost'}/twilio/media">
      sip:${roomName}@${process.env.TWILIO_TERMINATION_URI};transport=tls
  </Sip>
</Dial>
```

Key improvements:
- Longer timeout (120s) and call time limit (3600s)
- Added status callback endpoints for better diagnostics
- Enabled media streaming with bi-directional tracks
- Added TLS transport to the SIP URI
- Added caller ID to maintain the connection

### 3. Added Diagnostic Endpoints

Added webhook handlers in `index.js` to capture Twilio events:

- `/twilio/sip-status` - Handles SIP connection status updates
- `/twilio/dial-status` - Processes dial completion events
- `/twilio/media` - WebSocket endpoint for media streaming

### 4. WebSocket Support for Media Streaming

Added support for WebSocket connections to handle media streams:

```javascript
// Initialize WebSocket support
expressWs(app, server);

// Handle Twilio media streaming
app.ws('/twilio/media', (ws, req) => {
  console.log('Twilio media stream connected');
  // Media streaming handler
});
```

## Further Troubleshooting Steps

If call disconnection issues persist after implementing the above fixes, consider the following:

### Check Logs

1. **LiveKit SIP Server Logs**: Look for errors or warnings related to SIP connections or audio handling
   ```bash
   docker logs livekit-sip
   ```

2. **Backend Server Logs**: Check for errors in the Express server, particularly in the webhook handlers
   ```bash
   docker logs backend
   ```

3. **Twilio Logs**: Review the Twilio console for call detail records and any errors

### Test Network Configuration

1. Ensure your public hostname is correctly set and accessible from Twilio
2. Verify that your SIP endpoint is properly exposed and accessible
3. Test with a simple TwiML response before attempting the full SIP connection

### Verify Deepgram Integration

1. Test the Deepgram integration directly with sample audio
2. Ensure the port forwarding to your Kubernetes cluster is working correctly
3. Check that the `DEEPGRAM_API_KEY` environment variable is correctly set

### Debug SIP Configuration

1. Test the SIP connection with a simpler TwiML:
   ```xml
   <Response>
     <Dial>
       <Sip>sip:test@your-sip-server.com</Sip>
     </Dial>
   </Response>
   ```

2. Increase debug logging in the LiveKit SIP configuration:
   ```yaml
   log_level: debug
   ```

3. Try connecting directly to your SIP server with a SIP client like Linphone

## Potential Architectural Improvements

If problems persist, consider these architectural changes:

1. Use a dedicated SIP server with more robust diagnostics
2. Implement a direct WebRTC connection with Twilio instead of SIP
3. Use Twilio's built-in speech recognition capabilities as a fallback
4. Implement a more robust error handling and recovery strategy

## Contact Information

For further assistance with call connection issues, contact:
- LiveKit Support: https://livekit.io/contact
- Twilio Support: https://support.twilio.com
- Deepgram Support: https://deepgram.com/contact