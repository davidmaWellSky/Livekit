import { Injectable } from '@angular/core';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  TrackEvent,
  Participant,
  ConnectionState,
  ParticipantEvent,
  LocalParticipant
} from 'livekit-client';
import { BehaviorSubject, Observable, firstValueFrom, Subject } from 'rxjs';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LivekitService {
  private room?: Room;
  private _participants = new BehaviorSubject<Participant[]>([]);
  private _connected = new BehaviorSubject<boolean>(false);
  private _activeCall = new BehaviorSubject<boolean>(false);
  private _callParticipantId = new BehaviorSubject<string | null>(null);
  private _logs = new Subject<string>();
  private _connectionState = new BehaviorSubject<string>('disconnected');

  public participants$ = this._participants.asObservable();
  public connected$ = this._connected.asObservable();
  public activeCall$ = this._activeCall.asObservable();
  public callParticipantId$ = this._callParticipantId.asObservable();
  public logs$ = this._logs.asObservable();
  public connectionState$ = this._connectionState.asObservable();

  constructor(private apiService: ApiService) {}

  // Initialize and connect to a LiveKit room
  connect(identity: string, roomName: string): void {
    this.log(`CONNECTING: Room ${roomName} | Identity ${identity}`);
    this._connectionState.next('requesting_token');
    
    // Get token from API
    this.apiService.getToken(identity, roomName).subscribe({
      next: async (response) => {
        try {
          const token = response.token;
          
          this.log(`TOKEN: Successfully obtained token for ${identity} in room ${roomName}`);
          
          // Determine the best LiveKit host to use
          const livekitHost = await this.determineBestLiveKitHost();
          this.log(`CONFIG: LiveKit host is: ${livekitHost}`);
          
          this._connectionState.next('initializing_room');
          
          // Create a new room instance
          // Create Room with simple options
          this.room = new Room({
            adaptiveStream: true,
            dynacast: true,
            stopLocalTrackOnUnpublish: true
          });
          
          this.log('ROOM: Room instance created successfully');

          // Set up room event listeners
          this.setupRoomListeners();
          this.log('LISTENERS: Room event listeners set up');
          this._connectionState.next('connecting');

          try {
            // Connect to the room
            this.log(`CONNECTING: Attempting to connect to LiveKit at ${livekitHost}`);
            await this.room.connect(livekitHost, token);
            this.log(`SUCCESS: Connected to room: ${roomName}`);
            this._connectionState.next('connected');
            this._connected.next(true);
            
            // Update participants
            this.updateParticipants();
          } catch (error) {
            this.log(`ERROR: Failed to connect to room: ${error}`);
            this._connectionState.next('connection_error');
            console.error('Failed to connect to room:', error);
            this._connected.next(false);
          }
        } catch (error) {
          this.log(`ERROR: Room initialization error: ${error}`);
          this._connectionState.next('initialization_error');
          console.error('Failed to initialize room:', error);
          this._connected.next(false);
        }
      },
      error: (err) => {
        this.log(`Failed to get token: ${err}`);
        console.error('Failed to get token:', err);
        this._connected.next(false);
      }
    });
  }

  // Disconnect from the room
  disconnect(): void {
    if (this.room) {
      this.log('Disconnecting from room');
      this.room.disconnect();
      this.room = undefined;
      this._connected.next(false);
      this._participants.next([]);
      this._activeCall.next(false);
      this._callParticipantId.next(null);
      this.log('Successfully disconnected from room');
    }
  }

  // Call a patient phone number via SIP
  async callPatient(roomName: string, phoneNumber: string): Promise<void> {
    try {
      if (!this.room || !this._connected.value) {
        throw new Error('Not connected to a room');
      }

      if (!phoneNumber || phoneNumber.trim() === '') {
        throw new Error('Phone number is required to make a call');
      }

      this.log(`Initiating call to ${phoneNumber} in room ${roomName}`);
      const response = await firstValueFrom(this.apiService.initiateCall(roomName, phoneNumber));
      this.log(`Call initiated - Call SID: ${response.callSid}, Participant ID: ${response.callParticipantId || 'Unknown'}`);
      
      // Store Twilio call details
      this._activeCall.next(true);
      
      // Store the call participant ID (which may be the Twilio Call SID)
      if (response.callParticipantId) {
        this._callParticipantId.next(response.callParticipantId);
        this.log(`Call participant ID set to: ${response.callParticipantId}`);
      } else if (response.callSid) {
        this._callParticipantId.next(response.callSid);
        this.log(`Call participant ID set to Twilio Call SID: ${response.callSid}`);
      }
      
      // Set up a call status polling mechanism to update UI even if participant events don't fire
      this.setupCallStatusPolling(roomName, response.callSid);
    } catch (error) {
      this.log(`Error initiating call: ${error}`);
      console.error('Failed to initiate call:', error);
      throw error;
    }
  }

  // Hang up a call
  async hangupCall(roomName: string): Promise<void> {
    try {
      const participantId = this._callParticipantId.value;
      
      // We may or may not have a participant ID, but we can still try to hang up
      // by room name only since our backend now stores calls by room name
      if (participantId) {
        this.log(`Hanging up call with participant ID: ${participantId}`);
        await firstValueFrom(this.apiService.hangupCall(roomName, participantId));
      } else {
        this.log(`Hanging up call in room ${roomName} without participant ID`);
        await firstValueFrom(this.apiService.hangupCall(roomName, ""));
      }
      
      this.log('Call hangup request sent');
      this._activeCall.next(false);
      this._callParticipantId.next(null);
    } catch (error) {
      this.log(`Error hanging up call: ${error}`);
      console.error('Failed to hang up call:', error);
      
      // Even if there's an error, reset the call state so the UI doesn't get stuck
      this._activeCall.next(false);
      this._callParticipantId.next(null);
      
      throw error;
    }
  }

  // Update participants list
  private updateParticipants(): void {
    if (!this.room) return;
    
    const participants: Participant[] = [];
    
    // Add local participant if available
    if (this.room.localParticipant) {
      participants.push(this.room.localParticipant);
    }
    
    // Add all remote participants
    this.room.participants.forEach(participant => {
      participants.push(participant);
    });
    
    this._participants.next(participants);
  }

  // Set up room event listeners
  // Log messages both to console and to the logs subject
  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    this._logs.next(formattedMessage);
    console.log(`[LiveKit] ${message}`);
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    this.room
      .on(RoomEvent.ParticipantConnected, (participant: Participant) => {
        // Log all participant identities for debugging
        console.log(`DEBUG: Participant connected with identity: ${participant.identity} and SID: ${participant.sid}`);
        this.log(`Participant connected: ${participant.identity}`);
        
        // Expand detection patterns to catch all possible SIP participant formats
        const isSipParticipant = participant.identity.includes('sip:') ||
            participant.identity.includes('phone:') ||
            participant.identity.includes('twilio') ||
            participant.identity.includes('+') ||
            /^\d+$/.test(participant.identity) ||  // All digits (like a Twilio SID)
            (this._callParticipantId.value &&
             (participant.sid === this._callParticipantId.value ||
              participant.identity.includes(this._callParticipantId.value)));
            
        if (isSipParticipant) {
          this.log(`Detected SIP call participant: ${participant.identity} with SID: ${participant.sid}`);
          this._activeCall.next(true);
          this._callParticipantId.next(participant.sid);
        }
        
        // Always update participants list to refresh the UI
        this.updateParticipants();
      })
      .on(RoomEvent.ParticipantDisconnected, (participant: Participant) => {
        this.log(`Participant disconnected: ${participant.identity}`);
        
        // Check if this was our SIP participant
        if (participant.sid === this._callParticipantId.value) {
          this.log('SIP call participant disconnected, ending call');
          this._activeCall.next(false);
          this._callParticipantId.next(null);
        }
        
        this.updateParticipants();
      })
      .on(RoomEvent.Disconnected, () => {
        this.log('Disconnected from room');
        this._connected.next(false);
        this._participants.next([]);
        this._activeCall.next(false);
        this._callParticipantId.next(null);
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        this.log(`Track subscribed: ${track.kind} from ${participant.identity}`);
        
        // If this is an audio track
        if (track.kind === Track.Kind.Audio && participant instanceof RemoteParticipant) {
          this.log(`Attaching audio track from ${participant.identity}`);
          
          // Handle audio track - create an audio element with higher volume for SIP calls
          const audioElement = new Audio();
          audioElement.srcObject = new MediaStream([track.mediaStreamTrack]);
          
          // Set higher volume for better audio on phone calls
          audioElement.volume = 1.0;
          
          // Enable audio output on the audio element
          audioElement.muted = false;
          
          // Try to autoplay the audio
          audioElement.autoplay = true;
          
          // Force play the audio element
          const playPromise = audioElement.play();
          if (playPromise !== undefined) {
            playPromise.catch(error => {
              this.log(`Error playing audio: ${error}`);
              // Try playing again after user interaction
              document.addEventListener('click', () => {
                audioElement.play().catch(e => this.log(`Retry error: ${e}`));
              }, { once: true });
            });
          }
          
          // Check if this is potentially a SIP participant
          const isSipParticipant = participant.identity.includes('sip:') ||
            participant.identity.includes('phone:') ||
            participant.identity.includes('twilio') ||
            participant.identity.includes('+') ||
            /^\d+$/.test(participant.identity) ||
            (this._callParticipantId.value &&
             (participant.sid === this._callParticipantId.value ||
              participant.identity.includes(this._callParticipantId.value)));
          
          if (isSipParticipant && !this._activeCall.value) {
            this.log(`SIP participant ${participant.identity} with audio detected - marking call as active`);
            this._activeCall.next(true);
            this._callParticipantId.next(participant.sid);
          }
          
          // Monitor audio activity to confirm audio is flowing
          this.log(`Setting up audio activity monitoring for ${participant.identity}`);
          
          // For debugging, log when the participant is speaking
          participant.on(ParticipantEvent.IsSpeakingChanged, (speaking) => {
            if (speaking) {
              this.log(`${participant.identity} is speaking/making sound`);
            }
          });
          
          // Set up our own periodic check with more detailed logging
          const audioMonitoringInterval = setInterval(() => {
            const isSpeaking = participant.isSpeaking;
            if (isSpeaking) {
              this.log(`Audio activity detected from ${participant.identity}`);
              
              // If this is our SIP participant, ensure call is marked active
              if (isSipParticipant) {
                this._activeCall.next(true);
              }
            }
          }, 2000);
          
          // Clean up when track is unsubscribed
          track.once(TrackEvent.Ended, () => {
            this.log(`Cleaning up audio monitoring for ${participant.identity}`);
            clearInterval(audioMonitoringInterval);
          });
        }
      })
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        this.log(`Connection state changed: ${state}`);
        this._connectionState.next(state);
        
        // Update connected status based on connection state
        if (state === ConnectionState.Connected) {
          this._connected.next(true);
        } else if (state === ConnectionState.Disconnected) {
          this._connected.next(false);
        }
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        this.log(`Connection quality changed for ${participant.identity}: ${quality}`);
      })
      .on(RoomEvent.MediaDevicesError, (error) => {
        this.log(`Media devices error: ${error.message}`);
      });
  }

  /**
   * Set up polling to check call status directly from the backend
   * This ensures the UI updates even if LiveKit doesn't detect the participant
   */
  private setupCallStatusPolling(roomName: string, callSid: string): void {
    this.log(`Setting up call status polling for ${callSid} in room ${roomName}`);
    
    // Poll every 2 seconds for the first 30 seconds (15 polls)
    let pollCount = 0;
    const maxPolls = 15;
    
    const pollInterval = setInterval(() => {
      pollCount++;
      this.log(`Polling call status (${pollCount}/${maxPolls})`);
      
      // We need to check the call status from the backend
      // Since getCallStatus doesn't exist yet, we'll implement a workaround using the existing API
      this.apiService.getActiveCall(roomName).subscribe({
        next: (response: any) => {
          if (!response) {
            this.log(`Call status poll: No active call found`);
            return;
          }
          
          const status = response.status || 'unknown';
          this.log(`Call status poll: ${status}`);
          
          // If the call is active in any way, force update the UI
          if (status === 'in-progress' || status === 'answered' ||
              status === 'ringing' || status === 'queued') {
            this._activeCall.next(true);
            
            // Force check for participants that may have been missed
            if (this.room) {
              this.log('Force checking for missed participants...');
              
              // Look for any unknown participants that might be the phone call
              this.room.participants.forEach(participant => {
                this.log(`Found participant: ${participant.identity} (${participant.sid})`);
                
                // Check if this might be our phone participant
                const couldBePhoneParticipant =
                  participant.identity.includes('sip:') ||
                  participant.identity.includes('phone:') ||
                  participant.identity.includes('twilio') ||
                  participant.identity.includes('+') ||
                  /^\d+$/.test(participant.identity) ||
                  participant.identity.toLowerCase().includes('phone');
                
                if (couldBePhoneParticipant) {
                  this.log(`Found potential phone participant: ${participant.identity}`);
                  this._callParticipantId.next(participant.sid);
                  
                  // Force UI update
                  this.updateParticipants();
                }
              });
            }
          }
          
          // If the call is completed, update the UI
          if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
            this.log(`Call completed with status: ${status}`);
            this._activeCall.next(false);
            this._callParticipantId.next(null);
            clearInterval(pollInterval);
          }
        },
        error: (err) => {
          this.log(`Error polling call status: ${err}`);
        }
      });
      
      // Clear the interval after max polls
      if (pollCount >= maxPolls) {
        this.log('Stopping call status polling after maximum attempts');
        clearInterval(pollInterval);
      }
    }, 2000); // Poll every 2 seconds
  }

  /**
   * Determines the best LiveKit host URL to use
   * Since we're using host networking, localhost should always work
   */
  private async determineBestLiveKitHost(): Promise<string> {
    // Get the host from environment (should be localhost with our new config)
    const configuredHost = environment.livekitHost;
    this.log(`Configured LiveKit host: ${configuredHost}`);
    
    // Always use localhost (127.0.0.1) for WebRTC connection reliability
    const localHost = 'ws://localhost:7880';
    
    if (configuredHost !== localHost) {
      this.log(`Overriding configured host with ${localHost} for better connectivity`);
      return localHost;
    }
    
    return configuredHost;
  }
}