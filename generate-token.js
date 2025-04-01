const { AccessToken } = require('livekit-server-sdk');

async function generateToken() {
  try {
    // API key and secret from docker-compose.yml
    const apiKey = 'devkey';
    const apiSecret = 'secret';
    
    // Create access token with the API key and secret
    const at = new AccessToken(apiKey, apiSecret, {
      identity: 'test-user',    // the user's identity
      ttl: 3600 * 24,           // 24 hours in seconds
    });
    
    // Add a grant to join a specific room
    at.addGrant({
      roomJoin: true,
      room: 'test-room',
      canPublish: true,
      canSubscribe: true
    });
    
    // Generate and return the JWT token
    const token = await at.toJwt();
    return token;
  } catch (error) {
    console.error('Error generating token:', error);
    throw error;
  }
}

// Main function
async function main() {
  console.log('Generating LiveKit token...');
  
  try {
    // Create the token
    const token = await generateToken();
    
    console.log('\nGenerated token:');
    console.log(token);
    
    console.log('\nTo use this token:');
    console.log('1. Use ws://localhost:7880 as the LiveKit server URL');
    console.log('2. Use the token above for authentication');
    console.log('3. Make sure you are not using ws://livekit:7880 - this only works inside Docker');
  } catch (error) {
    console.error('Error in main:', error);
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
});