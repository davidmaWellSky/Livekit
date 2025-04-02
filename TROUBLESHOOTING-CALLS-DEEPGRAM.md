# Troubleshooting Call Issues with SIP and Deepgram Integration

This document outlines the changes made to fix issues with calls where the agent reports an application error when patients start speaking, and the call disconnects.

## Problem Description

- Initial greeting from the agent works
- When the patient speaks, an application error occurs
- The call disconnects after the error
- The error is related to speech processing (STT/TTS) functionality

## Root Causes Identified

1. **SIP URI Format Issue**: The SIP URI format used to connect Twilio calls to LiveKit was incorrect
2. **Authentication Conflict**: The system was trying to use an API key with port-forwarded Deepgram instances, causing authentication failures
3. **Audio Processing Issues**: The Twilio media WebSocket handler wasn't properly processing audio data
4. **Telephony Audio Format Mismatch**: The AI agent wasn't properly configured to handle telephony audio formats

## Changes Implemented

### 1. Fixed SIP URI Configuration

Updated `livekit-sip-config.yaml` to:
- Use correct domain (aiagenticlivekit.pstn.twilio.com instead of sip.twilio.com)
- Add appropriate realm configuration
- Update the URI format to match what's expected by Twilio

Updated `twilio.service.js` to:
- Explicitly build and log the SIP URI
- Ensure proper URL format for the SIP connection
- Add more detailed logging of SIP configuration status

### 2. Fixed Deepgram Port-Forwarded Authentication

Updated `deepgram.service.js` to:
- Skip sending API key for port-forwarded instances
- Use proper headers based on authentication method
- Increase timeouts for better reliability
- Handle API errors gracefully

### 2. Enhanced Twilio Media WebSocket Handler

Modified the WebSocket handler in `index.js` to:
- Properly buffer and process incoming audio chunks
- Add timing logic to process audio at appropriate intervals
- Better error handling and logging
- Use telephony-specific settings for audio processing

### 3. Improved AI Agent Audio Processing

Updated `ai-agent.js` to:
- Detect and properly handle telephony audio formats
- Set appropriate sample rate and encoding for phone calls
- Handle empty transcripts gracefully
- Add error recovery for TTS failures

## How to Test the Changes

1. Stop the currently running containers:
   ```
   docker-compose down
   ```

2. Start the system with the new changes:
   ```
   docker-compose up -d
   ```

3. Make a test call:
   - Navigate to the dashboard in your web browser
   - Enter a phone number and click "Call Patient"
   - When you answer, listen for the greeting
   - Try speaking after the greeting
   - The system should now properly process your speech without disconnecting

## Debug Logs to Monitor

If issues persist, check the following logs:

1. Backend logs for Deepgram errors:
   ```
   docker logs livekit-backend
   ```

2. LiveKit SIP server logs for media issues:
   ```
   docker logs livekit-sip
   ```

## Configuration Notes

- The system now explicitly uses the port-forwarded Deepgram instance without an API key
- Added retry logic and better error handling for more stability
- Telephony audio is now explicitly handled with the correct parameters (8kHz, mulaw encoding)

## Additional Logging for Debugging

We've added extensive additional logging to help pinpoint the exact issue:

1. **SIP Status Callbacks**: Enhanced to log detailed error codes and messages
2. **Detailed WebSocket Media Logging**: Added connection details and audio processing stats
3. **Environment Variables**: Added DEBUG=livekit:*,sip:*,twilio:* and LOG_LEVEL=debug
4. **Diagnostic Endpoint**: Added /diagnostics/sip-config endpoint to check configuration

## Checking for SIP URI Issues

The SIP URI format in Twilio logs was showing:
```
sip:consult-095422-293@aiagenticlivekit.pstn.twilio.com;transport=tls
```

This has been updated to ensure proper formatting and domain configuration throughout the system.

By addressing these specific issues, the conversational aspect of calls should now function properly. If you continue to see the application error message, check the logs for specific error codes which will now be captured and displayed.