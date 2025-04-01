# LiveKit Twilio Integration PoC

This project is a proof of concept to test whether LiveKit's SDK would allow an agent gateway to trigger outbound SIP calls to Twilio for appointment scheduling. The system integrates LiveKit with Twilio and Deepgram for Text-to-Speech (TTS) and Speech-to-Text (STT) functionality.

## Architecture

The project consists of several components:

1. **LiveKit Server**: Manages WebRTC rooms and participants
2. **LiveKit SIP Server**: Handles SIP communications
3. **Backend Server**: Node.js application that integrates LiveKit, Twilio, and Deepgram
4. **Frontend Application**: Angular web app that simulates an agent gateway for testing

## Features

- Make outbound calls to patients via Twilio
- Real-time two-way audio communication
- AI agent integration for automated conversations
- Speech-to-text and text-to-speech capabilities using Deepgram
- Room management for agent-patient interactions

## Prerequisites

- Docker and Docker Compose
- Node.js (v16+) and npm
- Twilio account with:
  - Account SID
  - Auth Token
  - Phone number with voice capabilities
  - SIP Trunk SID
- Deepgram API key for speech services
- Gemini API key for AI agent (optional, for testing)

## Setup

1. Clone this repository

2. Configure environment variables:
   - Copy `.env.local` file in the backend directory and fill in your credentials:
     ```
     # LiveKit Configuration
     LIVEKIT_HOST=localhost:7880
     LIVEKIT_API_KEY=devkey
     LIVEKIT_API_SECRET=secret
     
     # Twilio Configuration
     TWILIO_ACCOUNT_SID=your_account_sid
     TWILIO_AUTH_TOKEN=your_auth_token
     TWILIO_PHONE_NUMBER=your_twilio_phone_number
     TWILIO_TRUNK_SID=your_trunk_sid
     TWILIO_TERMINATION_URI=your_termination_uri
     
     # Deepgram Configuration
     DEEPGRAM_API_KEY=your_deepgram_api_key
     DEEPGRAM_URL=http://localhost:9012
     
     # AI Agent Configuration
     GEMINI_API_KEY=your_gemini_api_key
     ```

3. Start only the LiveKit infrastructure containers:
   ```
   docker-compose up -d
   ```

4. Run the backend server:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

5. Run the frontend application:
   ```bash
   cd frontend
   npm install
   npm start
   ```

6. Access the application at http://localhost:4200

## Testing the Integration

1. Open the frontend application in your browser.
2. Navigate to the dashboard and create a new room or select an existing one.
3. In the room, use the "Call Patient" button to open the patient form.
4. Enter a phone number to call (in E.164 format, e.g., +1234567890).
5. When connected, the application will create a LiveKit room, connect the agent to it, and initiate an outbound call via Twilio to the specified number.
6. The AI agent will handle the conversation using Deepgram for speech-to-text and text-to-speech.
7. Use the call controls to hang up when finished.

## Ports and Services

- LiveKit Server: http://localhost:7880
- Backend API: http://localhost:3001
- Frontend Application: http://localhost:4200
- LiveKit SIP Server: Port 5060 (UDP) for SIP signaling, Port 5080 for HTTP API

## Manual Testing with Direct Twilio Call

To test a direct outbound call:

1. Ensure all services are running
2. Use curl to make a request to the backend:
   ```bash
   curl -X POST http://localhost:3001/call \
     -H "Content-Type: application/json" \
     -d '{"room":"test-room","phoneNumber":"+1234567890"}'
   ```
3. Verify the call is initiated and the AI agent responds correctly

## Troubleshooting

- **SIP Connection Issues**: Check the LiveKit SIP server logs with `docker logs livekit-sip`
- **Call Failures**: Verify Twilio credentials and check Twilio logs for error details
- **Audio Problems**: Ensure the browser has microphone permissions and WebRTC is working correctly
- **Room Connection Issues**: Check LiveKit server logs with `docker logs livekit`

## Development

### Running Backend Locally (Without Docker)

```bash
cd backend
npm install
npm run dev
```

### Running Frontend Locally (Without Docker)

```bash
cd frontend
npm install
npm start
```

## Architecture Diagram

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│             │    │             │    │             │
│  Frontend   │◄──►│  Backend    │◄──►│  LiveKit    │
│  (Angular)  │    │  (Node.js)  │    │  Server     │
│             │    │             │    │             │
└─────────────┘    └──────┬──────┘    └──────┬──────┘
                          │                   │
                          ▼                   ▼
                   ┌─────────────┐    ┌─────────────┐
                   │             │    │             │
                   │  Twilio     │    │  LiveKit    │
                   │  API        │    │  SIP Server │
                   │             │    │             │
                   └──────┬──────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │             │
                   │  Phone      │
                   │  Network    │
                   │             │
                   └─────────────┘
```

## Notes

- This is a proof of concept and not intended for production use without additional development and security measures.
- The AI agent is configured for appointment scheduling but can be customized for other use cases.
- Direct Twilio integration is used as SIP wasn't working in previous attempts.