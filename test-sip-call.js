/**
 * LiveKit SIP Call Test Script
 * 
 * This script initiates an outbound SIP call from LiveKit to Twilio,
 * which then calls a specified phone number.
 * 
 * Run with: node test-sip-call.js [phone_number]
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple logger implementation
const logger = {
  logFile: 'sip-call-test.log',
  
  // Initialize log file
  init() {
    try {
      fs.writeFileSync(this.logFile, `=== LiveKit SIP Call Test Log - ${new Date().toISOString()} ===\n\n`);
    } catch (err) {
      console.error(`Failed to create log file: ${err.message}`);
    }
  },
  
  // Log to console and file
  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMsg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Console output with colors
    const colors = {
      INFO: '\x1b[32m', // Green
      DEBUG: '\x1b[36m', // Cyan
      ERROR: '\x1b[31m'  // Red
    };
    
    console.log(`${colors[level.toUpperCase()] || ''}${logMsg}\x1b[0m`);
    
    // File output
    try {
      fs.appendFileSync(this.logFile, logMsg + '\n');
    } catch (err) {
      console.error(`Failed to write to log file: ${err.message}`);
    }
  },
  
  info(message) {
    this.log('INFO', message);
  },
  
  debug(message) {
    this.log('DEBUG', message);
  },
  
  error(message) {
    this.log('ERROR', message);
  }
};

// Initialize log file
logger.init();

// Load environment variables
function loadEnvVars() {
  logger.info('Loading environment variables from .env.local');
  try {
    const envPath = path.resolve(__dirname, 'backend', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    
    envContent.split('\n').forEach(line => {
      // Skip comments and empty lines
      if (!line || line.trim().startsWith('#')) return;
      
      // Split by first equals sign
      const equalsPos = line.indexOf('=');
      if (equalsPos > 0) {
        const key = line.substring(0, equalsPos).trim();
        const value = line.substring(equalsPos + 1).trim();
        
        if (key && value) {
          envVars[key] = value;
          // Don't log sensitive values
          if (!key.includes('SECRET') && !key.includes('TOKEN') && !key.includes('KEY') && 
              !key.includes('SID') && !key.includes('PASSWORD')) {
            logger.debug(`Loaded env var: ${key}=${value}`);
          } else {
            logger.debug(`Loaded env var: ${key}=****`);
          }
        }
      }
    });
    
    return envVars;
  } catch (error) {
    logger.error(`Failed to load .env.local file: ${error.message}`);
    throw error;
  }
}

// Create LiveKit Authorization header using API key/secret
function createAuthHeader(apiKey, apiSecret) {
  logger.debug('Creating LiveKit authorization header');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${timestamp}:${apiKey}`)
    .digest('hex');
  
  return {
    Authorization: `LIVEKIT-API-KEY ${apiKey}:${timestamp}:${signature}`
  };
}

// Make the SIP call
async function makeSipCall(envVars, destinationPhoneNumber) {
  const livekitHost = envVars.LIVEKIT_HOST || 'localhost:7880';
  const apiKey = envVars.LIVEKIT_API_KEY || 'devkey';
  const apiSecret = envVars.LIVEKIT_API_SECRET || 'secret';
  
  // The SIP server exposes HTTP API at port 5080
  // Set timeout for API requests
  const axios_timeout = 30000; // Increase timeout to 30 seconds
  
  // Add debug request configuration
  axios.interceptors.request.use(request => {
    logger.debug(`Making request to: ${request.url}`);
    return request;
  });
  
  // Try different URLs to find one that works
  // First try localhost (for debugging from host)
  // Then try the container name (for container to container communication)
  // Then try the IP we saw in logs
  const sipApiUrls = [
    'http://localhost:5080',
    'http://livekit-sip:5080',
    'http://172.23.0.4:5080'
  ];
  
  // Extra debugging info
  logger.debug(`Using LiveKit Host: ${livekitHost}`);
  logger.debug(`Available SIP API URLs: ${sipApiUrls.join(', ')}`);
  
  logger.info(`Making SIP call to phone number: ${destinationPhoneNumber}`);
  
  // Create unique call reference
  const callRef = `call-${Date.now()}`;
  
  // Create request headers with authorization
  const headers = createAuthHeader(apiKey, apiSecret);
  
  // Create call request payload
  const payload = {
    // Trunk ID as configured in livekit-sip-config.yaml
    trunk_id: 'local-trunk',
    // Target phone number to call
    destination: destinationPhoneNumber,
    // Call reference ID for tracking
    ref: callRef,
    // Room to create for the call
    room: `room-${callRef}`,
    // Reference to the Twilio Termination URI in case SIP server needs it
    termination_uri: envVars.TWILIO_TERMINATION_URI || 'aiagenticlivekit.pstn.twilio.com',
    // Call options for Twilio
    headers: {
      // Pass the Twilio account & auth token for authentication
      'X-Twilio-AccountSid': envVars.TWILIO_ACCOUNT_SID,
      'X-Twilio-AuthToken': envVars.TWILIO_AUTH_TOKEN,
      // From number should be a Twilio number
      'From': envVars.TWILIO_PHONE_NUMBER,
      // Caller ID for the outbound call
      'Caller-ID': envVars.TWILIO_PHONE_NUMBER,
      // Twilio credential list if needed
      'X-Twilio-Username': envVars.TWILIO_CREDENTIAL_LIST_USERNAME,
      'X-Twilio-Password': envVars.TWILIO_CREDENTIAL_LIST_PASSWORD,
      // Pass the Twilio SIP Domain/Termination URI
      'X-Twilio-SIP-Domain': envVars.TWILIO_TERMINATION_URI,
      // Pass the TWILIO_TRUNK_SID to make sure it's available
      'X-Twilio-Trunk-SID': envVars.TWILIO_TRUNK_SID,
      // Optional headers for debugging
      'X-Debug': 'true',
      'X-Call-Source': 'test-script'
    }
  };
  
  logger.debug(`Call payload: ${JSON.stringify(payload, null, 2)}`);
  
  // Check if trunk ID variable is set properly
  if (!process.env.SIP_TRUNK_ID && process.env.SIP_TRUNK_ID !== 'local-trunk') {
    // Add fallback to make sure trunk ID is set
    process.env.SIP_TRUNK_ID = 'local-trunk';
    logger.debug('Set SIP_TRUNK_ID=local-trunk as a fallback');
  }
    
  // Test basic connectivity to Docker containers first
  try {
    logger.info('Checking Docker network connectivity...');
    const testResponse = await axios.get('http://localhost:7880/rtc', {
      timeout: 5000,
      validateStatus: () => true // Accept any status code
    });
    logger.info(`LiveKit server connection test: ${testResponse.status}`);
  } catch (error) {
    logger.error(`LiveKit server connection test failed: ${error.message}`);
    logger.info('This may indicate a Docker network issue, but continuing with SIP call attempt...');
  }
  
  // Try each SIP API URL until one works
  let lastError = null;
  let responseData = null;
  let workingSipApiUrl = null;
  
  for (const url of sipApiUrls) {
    try {
      logger.info(`Trying SIP API URL: ${url}`);
      
      // First try a simple healthcheck to check connectivity
      try {
        logger.debug(`Testing basic connectivity to ${url}`);
        await axios.get(`${url}/healthz`, {
          timeout: 5000,
          validateStatus: () => true // Accept any status code
        });
      } catch (healthError) {
        logger.debug(`Healthcheck for ${url} failed: ${healthError.message}`);
        // Continue with the call attempt even if healthcheck fails
      }
      
      // Send request to SIP server's call API with timeout and retry logic
      const endpoint = `${url}/v1/trunks/${payload.trunk_id}/call`;
      logger.debug(`POSTing to ${endpoint}`);
      
      const response = await axios.post(
        endpoint,
        payload,
        {
          headers,
          timeout: axios_timeout,
          // Add specific axios config options that may help with hanging sockets
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      
      // If we get here, the request succeeded
      logger.info(`Successfully connected to ${url}`);
      logger.info(`Call initiated successfully. Call ID: ${response.data.call_id}`);
      logger.debug(`Full response: ${JSON.stringify(response.data, null, 2)}`);
      
      // Save the working URL and response data
      workingSipApiUrl = url;
      responseData = response.data;
      
      // Break out of the loop since we found a working URL
      break;
    } catch (error) {
      lastError = error;
      logger.error(`Failed to connect to ${url}: ${error.message}`);
      // Continue to the next URL in the array
    }
  }
  
  // If we've tried all URLs and none worked
  if (!responseData) {
    if (lastError) {
      // More detailed error handling with deeper diagnostics
      if (lastError.code === 'ECONNABORTED') {
        logger.error('Connection timeout error. The SIP server is not responding in time.');
        logger.error('Try restarting the LiveKit SIP container: docker-compose restart livekit-sip');
        logger.error('You may also try increasing the timeout value in the script.');
      } else if (lastError.code === 'ECONNREFUSED') {
        logger.error('Connection refused. Make sure the LiveKit SIP server is running on port 5080');
        logger.error('Check with: docker-compose ps');
        logger.error('You could try an alternative SIP URL:');
        for (const url of sipApiUrls) {
          logger.error(`- ${url}`);
        }
      } else if (lastError.message.includes('socket hang up')) {
        logger.error('Socket hang up error. This often indicates the SIP server accepted the connection but closed it unexpectedly.');
        logger.error('Possible causes:');
        logger.error('1. Authentication issues - check your API key and secret');
        logger.error('2. Malformed request - check the payload format');
        logger.error('3. Server internal error - check the SIP server logs with: docker-compose logs livekit-sip');
        logger.error('4. Network connectivity issues between host and container');
          
        // Windows-specific network suggestions
        logger.error('Since you are running on Windows with Docker bridge network, try these specific solutions:');
        logger.error('1. Check Windows firewall settings - ensure Node.js has network permissions');
        logger.error('2. Try using the Docker host IP directly instead of localhost');
        logger.error('3. Check Docker Desktop network settings - enable "Expose daemon on tcp://localhost:2375"');
      }
      
      // Check if the trunk URI is properly formed
      if (payload.trunk_id === 'local-trunk') {
        logger.error('Checking trunk configuration:');
        logger.error(`- URI: sip:${envVars.TWILIO_TRUNK_SID}@sip.twilio.com`);
        logger.error(`- TWILIO_TRUNK_SID: ${envVars.TWILIO_TRUNK_SID ? 'is set' : 'is NOT set (problem)'}`);
        logger.error(`- TWILIO_TERMINATION_URI: ${envVars.TWILIO_TERMINATION_URI}`);
      }
      
      if (lastError.response) {
        logger.error(`Response data: ${JSON.stringify(lastError.response.data)}`);
        logger.error(`Response status: ${lastError.response.status}`);
      }
      
      throw lastError;
    }
    throw new Error('Failed to connect to any SIP API URL');
  }
  
  // Monitor call status for a short period
  let callActive = true;
  let attempts = 0;
  
  logger.info('Monitoring call status...');
  
  while (callActive && attempts < 60) { // Monitor for up to 60 seconds
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    try {
      // Get call status using the working URL
      const statusResponse = await axios.get(
        `${workingSipApiUrl}/v1/calls/${responseData.call_id}`,
        {
          headers,
          timeout: axios_timeout
        }
      );
      
      logger.info(`Call status: ${statusResponse.data.status}`);
      logger.debug(`Status details: ${JSON.stringify(statusResponse.data, null, 2)}`);
      
      // Check if call is still active
      if (['completed', 'failed', 'busy', 'no-answer'].includes(statusResponse.data.status)) {
        callActive = false;
        logger.info(`Call ended with status: ${statusResponse.data.status}`);
      }
    } catch (error) {
      logger.error(`Error checking call status: ${error.message}`);
      if (error.code === 'ECONNABORTED') {
        logger.error('Connection timeout when checking call status. You may need to restart the SIP server.');
      }
      // If we can't check status, assume call might still be active
    }
    
    attempts++;
  }
  
  if (callActive) {
    logger.info('Call monitoring timeout reached. Call may still be active.');
  }
  
  return responseData;
}

// Main execution function
async function main() {
  logger.info('=== LiveKit SIP Call Test Script ===');
  
  try {
    // Get phone number from command line or use default
    const DEFAULT_PHONE_NUMBER = '+14014578910';
    const phoneNumber = process.argv[2] || DEFAULT_PHONE_NUMBER;
    
    logger.info(`Using phone number: ${phoneNumber}${!process.argv[2] ? ' (default)' : ''}`);
    
    // Load environment variables
    const envVars = loadEnvVars();
    
    // Make the SIP call
    await makeSipCall(envVars, phoneNumber);
    
    logger.info('Test script completed successfully');
  } catch (error) {
    logger.error(`Test script failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main();