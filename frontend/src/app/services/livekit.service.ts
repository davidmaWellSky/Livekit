import { Injectable } from '@angular/core';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
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
        this.log(`Participant connected: ${participant.identity}`);
        this.updateParticipants();
        
        // Check if this might be our SIP participant
        if (participant.identity.includes('sip:') || participant.identity.includes('phone:')) {
          this.log(`Detected potential SIP call participant: ${participant.identity}`);
          this._activeCall.next(true);
          this._callParticipantId.next(participant.sid);
        }
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
        
        // If this is an audio track from SIP participant
        if (track.kind === Track.Kind.Audio && participant instanceof RemoteParticipant) {
          this.log(`Attaching audio track from ${participant.identity}`);
          
          // Handle audio track (e.g., attaching to audio element)
          const audioElement = new Audio();
          audioElement.srcObject = new MediaStream([track.mediaStreamTrack]);
          audioElement.play().catch(error => {
            this.log(`Error playing audio: ${error}`);
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