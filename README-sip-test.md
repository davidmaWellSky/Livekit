# LiveKit SIP Call Test Script

This script allows you to test outbound SIP calls from LiveKit to Twilio, which then forwards the call to your phone number.

## Prerequisites

1. Docker containers for LiveKit and LiveKit SIP already running
2. Node.js installed on your Windows machine
3. Twilio account with credentials configured in `backend/.env.local`

## Setup Instructions

1. Install the required dependencies:
   ```
   npm install
   ```

2. Ensure your LiveKit containers are running:
   ```
   docker-compose ps
   ```

   You should see `livekit` and `livekit-sip` containers running.

## Running the Test

To make a test call, you can run the script directly or use the provided batch file:

```
node test-sip-call.js [phone_number]
```
or
```
run-sip-test.bat [phone_number]
```

If you don't provide a phone number, the default number `+14014578910` will be used.

The phone number should be in E.164 format (with country code, e.g., +11234567890).

## How It Works

1. The script loads Twilio credentials from `backend/.env.local`
2. It creates a proper authorization header using LiveKit API key/secret
3. A request is sent to the LiveKit SIP server running at port 5080
4. LiveKit SIP initiates a call to Twilio using the specified trunk
5. Twilio then forwards the call to your specified phone number
6. The script monitors the call status for up to 60 seconds

## Logging

The script provides detailed logging in two places:
- Console output shows real-time progress
- A log file `sip-call-test.log` is created with comprehensive debug information

## Troubleshooting

If the call fails, check:

1. Docker containers are running properly:
   ```
   docker-compose logs --follow livekit-sip
   ```

2. Your Twilio credentials in `backend/.env.local` are correct

3. The phone number format is in E.164 (e.g., +11234567890)

4. Network connectivity between LiveKit SIP and Twilio