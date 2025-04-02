# LiveKit Deepgram Integration

This documentation explains how the project has been refactored to leverage LiveKit as a blackbox for Deepgram integration, handling speech-to-text (STT) and text-to-speech (TTS) functionality.

## Architecture Overview

The new architecture uses LiveKit SIP server's built-in Deepgram integration capabilities as described in the [official LiveKit Deepgram documentation](https://docs.livekit.io/agents/integrations/deepgram/). This approach eliminates the need for direct Deepgram API calls from the Agent Gateway service, creating a cleaner separation of concerns.

### Key Components

1. **LiveKit Server**: Central WebRTC SFU (Selective Forwarding Unit) that handles media routing
2. **LiveKit SIP Server**: Handles SIP connections and now manages Deepgram integration
3. **Agent Gateway**: Focuses purely on business logic, connecting to LiveKit without needing to handle STT/TTS directly
4. **Deepgram Service**: Now accessed through LiveKit rather than directly

## Configuration Changes

The following changes were made to enable LiveKit's Deepgram integration:

### 1. SIP Server Configuration (`livekit-sip-config.yaml`)

Added ASR (Automatic Speech Recognition) and TTS (Text-to-Speech) configuration:

```yaml
sip:
  # ... existing configuration ...
  
  # ASR (Automatic Speech Recognition) configuration
  asr:
    provider: deepgram
    enabled: true
    language: en-US

  # TTS (Text-to-Speech) configuration
  tts:
    provider: deepgram
    enabled: true
    voice: female-1
    language: en-US

# Deepgram configuration for ASR/TTS
deepgram:
  url: http://host.docker.internal:9012  # Port-forwarding to Kubernetes cluster
  api_key: ${DEEPGRAM_API_KEY}
  model: general
```

### 2. Docker Compose Updates

Added Deepgram API key environment variable to the LiveKit SIP container and configured host access:

```yaml
livekit-sip:
  # ... existing configuration ...
  environment:
    - SIP_TRUNK_ID=local-trunk
    - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY:-mock-api-key}
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

## Code Changes

### 1. Backend Services

- **AI Agent Service**: Updated to work with LiveKit's Deepgram integration
- **LiveKit Agent Manager**: Modified to leverage LiveKit's built-in capabilities
- **API Endpoints**: Marked direct Deepgram endpoints as deprecated

### 2. Transition Strategy

We've implemented a hybrid approach to ensure backward compatibility:

- Direct Deepgram API calls are maintained but marked as deprecated
- New code paths leverage LiveKit's Deepgram integration
- Warning logs indicate when deprecated functionality is being used

## Benefits of the New Architecture

1. **Simplified Integration**: LiveKit handles all media processing and Deepgram integration
2. **Reduced Code Complexity**: Agent Gateway no longer needs to implement STT/TTS logic
3. **Better Scalability**: Speech processing happens within LiveKit's infrastructure
4. **Easier Maintenance**: Fewer integration points to maintain and troubleshoot

## Future Improvements

1. **Complete Transition**: Remove all direct Deepgram API calls once the LiveKit integration is fully tested
2. **Enhanced Logging**: Add more detailed logs to monitor LiveKit's Deepgram integration performance
3. **Configuration UI**: Add admin interface to adjust Deepgram settings without modifying YAML files

## Troubleshooting

If you encounter issues with the Deepgram integration:

1. Verify that the port forwarding to your Deepgram instance in Kubernetes is working correctly
2. Check that the `DEEPGRAM_API_KEY` environment variable is properly set
3. Review LiveKit SIP server logs for any Deepgram connection issues
4. Ensure the host.docker.internal DNS resolution works from within the LiveKit SIP container

## References

- [LiveKit Deepgram Integration Documentation](https://docs.livekit.io/agents/integrations/deepgram/)
- [LiveKit SIP Outbound Calls Documentation](https://docs.livekit.io/sip/outbound-calls/)