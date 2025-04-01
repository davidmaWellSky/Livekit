import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LivekitService } from '../../services/livekit.service';
import { Subscription } from 'rxjs';
import { Participant } from 'livekit-client';

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.scss']
})
export class CallComponent implements OnInit, OnDestroy {
  agentName: string = '';
  roomName: string = '';
  participants: Participant[] = [];
  connected: boolean = false;
  activeCall: boolean = false;
  showPatientForm: boolean = true;
  error: string = '';
  
  private participantsSubscription?: Subscription;
  private connectedSubscription?: Subscription;
  private activeCallSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private livekitService: LivekitService
  ) {}

  ngOnInit(): void {
    // Use a generated agent name - no need for login
    this.agentName = `Agent-${Math.floor(Math.random() * 1000)}`;
    
    // Get room name from route parameters
    this.route.paramMap.subscribe(params => {
      const roomParam = params.get('room');
      if (!roomParam) {
        this.router.navigate(['/dashboard']);
        return;
      }
      
      this.roomName = roomParam;
      
      // Store agent name in localStorage for persistence
      localStorage.setItem('agentName', this.agentName);
      
      this.connectToRoom();
    });

    // Subscribe to LiveKit service observables
    this.participantsSubscription = this.livekitService.participants$.subscribe(
      participants => this.participants = participants
    );
    
    this.connectedSubscription = this.livekitService.connected$.subscribe(
      connected => this.connected = connected
    );
    
    this.activeCallSubscription = this.livekitService.activeCall$.subscribe(
      activeCall => {
        this.activeCall = activeCall;
        if (activeCall) {
          this.showPatientForm = false;
        }
      }
    );
  }

  connectToRoom(): void {
    try {
      this.livekitService.connect(this.agentName, this.roomName);
    } catch (error) {
      console.error('Failed to connect to room:', error);
      this.error = 'Failed to connect to LiveKit room. Please try again.';
    }
  }

  async initiateCall(phoneNumber: string): Promise<void> {
    try {
      await this.livekitService.callPatient(this.roomName, phoneNumber);
    } catch (error) {
      console.error('Failed to initiate call:', error);
      this.error = 'Failed to initiate call. Please try again.';
    }
  }

  async hangupCall(): Promise<void> {
    try {
      await this.livekitService.hangupCall(this.roomName);
    } catch (error) {
      console.error('Failed to hang up call:', error);
      this.error = 'Failed to hang up call. Please try again.';
    }
  }

  showForm(): void {
    this.showPatientForm = true;
  }

  hideForm(): void {
    this.showPatientForm = false;
  }

  exitRoom(): void {
    // Disconnect from LiveKit and navigate back to dashboard
    this.livekitService.disconnect();
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.participantsSubscription?.unsubscribe();
    this.connectedSubscription?.unsubscribe();
    this.activeCallSubscription?.unsubscribe();
    
    // Disconnect from LiveKit
    this.livekitService.disconnect();
  }
}