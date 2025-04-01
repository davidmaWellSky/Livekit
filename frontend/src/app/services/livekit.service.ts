import { Injectable } from '@angular/core';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  Track,
  Participant,
  ConnectionState,
  ParticipantEvent,
  LocalParticipant
} from 'livekit-client';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
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

  public participants$ = this._participants.asObservable();
  public connected$ = this._connected.asObservable();
  public activeCall$ = this._activeCall.asObservable();
  public callParticipantId$ = this._callParticipantId.asObservable();

  constructor(private apiService: ApiService) {}

  // Initialize and connect to a LiveKit room
  connect(identity: string, roomName: string): void {
    // Get token from API
    this.apiService.getToken(identity, roomName).subscribe({
      next: (response) => {
        const token = response.token;
        
        // Create a new room if it doesn't exist
        this.apiService.createRoom(roomName).subscribe({
          next: async () => {
            try {
              // Create a new room instance
              this.room = new Room();

              // Set up room event listeners
              this.setupRoomListeners();

              // Connect to the room
              await this.room.connect(environment.livekitHost, token);
              console.log('Connected to room:', roomName);
              this._connected.next(true);
              
              // Update participants
              this.updateParticipants();
            } catch (error) {
              console.error('Failed to connect to room:', error);
              this._connected.next(false);
            }
          },
          error: (err) => {
            console.error('Failed to create room:', err);
            this._connected.next(false);
          }
        });
      },
      error: (err) => {
        console.error('Failed to get token:', err);
        this._connected.next(false);
      }
    });
  }

  // Disconnect from the room
  disconnect(): void {
    if (this.room) {
      this.room.disconnect();
      this.room = undefined;
      this._connected.next(false);
      this._participants.next([]);
      this._activeCall.next(false);
      this._callParticipantId.next(null);
    }
  }

  // Call a patient phone number via SIP
  async callPatient(roomName: string, phoneNumber: string): Promise<void> {
    try {
      if (!this.room || !this._connected.value) {
        throw new Error('Not connected to a room');
      }

      const response = await firstValueFrom(this.apiService.initiateCall(roomName, phoneNumber));
      console.log('Call initiated:', response);
      this._activeCall.next(true);
      this._callParticipantId.next(response.callId);
    } catch (error) {
      console.error('Failed to initiate call:', error);
      throw error;
    }
  }

  // Hang up a call
  async hangupCall(roomName: string): Promise<void> {
    try {
      const participantId = this._callParticipantId.value;
      if (!participantId) {
        throw new Error('No active call participant ID');
      }

      await firstValueFrom(this.apiService.hangupCall(roomName, participantId));
      console.log('Call hung up');
      this._activeCall.next(false);
      this._callParticipantId.next(null);
    } catch (error) {
      console.error('Failed to hang up call:', error);
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
  private setupRoomListeners(): void {
    if (!this.room) return;

    this.room
      .on(RoomEvent.ParticipantConnected, () => {
        console.log('Participant connected');
        this.updateParticipants();
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        console.log('Participant disconnected');
        this.updateParticipants();
      })
      .on(RoomEvent.Disconnected, () => {
        console.log('Disconnected from room');
        this._connected.next(false);
        this._participants.next([]);
        this._activeCall.next(false);
        this._callParticipantId.next(null);
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log('Track subscribed:', track.kind);
        
        // If this is an audio track from SIP participant
        if (track.kind === Track.Kind.Audio && participant instanceof RemoteParticipant) {
          // Handle audio track (e.g., attaching to audio element)
          const audioElement = new Audio();
          audioElement.srcObject = new MediaStream([track.mediaStreamTrack]);
          audioElement.play();
        }
      });
  }
}