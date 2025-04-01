# LiveKit SIP Outbound Calls Demo

This is a proof-of-concept application to test whether LiveKit's SDK would work as a tool to connect and trigger outbound SIP trunk calls to Twilio, which then calls patients to schedule appointments.

## Architecture

This demo consists of the following components:

1. **Angular Frontend**: A web interface for agents to initiate calls to patients
2. **Node.js Backend**: Serves as the middle layer between the frontend and LiveKit, with endpoints for token generation and call management
3. **LiveKit Server**: Handles WebRTC connections and communications
4. **LiveKit SIP Server**: Connects to SIP trunks (Twilio) for outbound calling

## Workflow

1. Agent logs in with their name
2. Agent creates or joins a room
3. Agent initiates a call to a patient by entering their phone number
4. LiveKit SIP server routes the call through a SIP trunk to Twilio
5. Twilio places the outbound call to the patient
6. When the patient answers, a two-way audio connection is established between the agent and patient
7. Agent can end the call when the appointment scheduling is complete

## Setup Instructions

### Prerequisites

- Docker and Docker Compose
- Twilio account with a SIP trunk configured

### Configuration

1. Update the `.env.local` file in the backend directory with your Twilio credentials:

```
# LiveKit Configuration
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone
TWILIO_TRUNK_SID=your_trunk_sid
```

### Running the Demo

1. Start all services using Docker Compose:

```bash
docker-compose up --build
```

2. Access the application:
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:3000
   - LiveKit server: ws://localhost:7880

3. Log in as an agent, create a room, and start making calls to test the integration.

## Technical Details

### LiveKit SIP Integration

The LiveKit SIP server creates a bridge between WebRTC and SIP protocols, allowing the agent to communicate with the patient through Twilio's SIP trunk. The backend server manages this integration through the LiveKit server SDK.

Key components:
- `RoomServiceClient` from the LiveKit server SDK to manage rooms and participants
- `SipParticipant` to add SIP endpoints to rooms
- WebRTC for agent audio communication

### Twilio SIP Trunk Integration

The system uses Twilio SIP trunks to route calls from LiveKit to the PSTN network. When an agent initiates a call, the backend:
1. Creates a SIP URI targeting the Twilio trunk
2. Adds it as a SIP participant to the room
3. Twilio routes the call to the specified phone number

## Testing Notes

When testing, you may need to configure your Twilio SIP trunk to:
1. Accept calls from your LiveKit SIP server's IP address
2. Forward calls to your Twilio phone number
3. Handle authentication properly between LiveKit SIP and Twilio

## Limitations and Considerations

- The demo uses development credentials. In production, secure credentials should be used.
- Audio quality depends on network conditions between all components.
- For production use, consider adding call recording, logging, and monitoring.