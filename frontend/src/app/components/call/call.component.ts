import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LivekitService } from '../../services/livekit.service';
import { Subscription } from 'rxjs';
import { Participant } from 'livekit-client';
import { environment } from '../../../environments/environment';

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
  showPatientForm: boolean = false; // Changed to false by default
  error: string = '';
  autoCallPhoneNumber: string | null = null;
  callLogs: string[] = []; // Add call logs array
  connectionState: string = 'disconnected';
  environment = environment; // Expose environment to the template
  callStartTime: Date | null = null;
  
  private participantsSubscription?: Subscription;
  private connectedSubscription?: Subscription;
  private activeCallSubscription?: Subscription;
  private connectionStateSubscription?: Subscription;
  private logsSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private livekitService: LivekitService
  ) {
    // Check if there's auto-call data in the router state
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state as {
      autoCall?: boolean;
      phoneNumber?: string;
    };
    
    if (state?.autoCall && state?.phoneNumber) {
      // Store the phone number to use after connection
      this.autoCallPhoneNumber = state.phoneNumber;
    }
  }

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
      
      // If we have an auto-call phone number, don't show the form initially
      if (this.autoCallPhoneNumber) {
        this.showPatientForm = false;
      } else {
        this.showPatientForm = true;
      }
    });

    // Subscribe to LiveKit service observables
    this.participantsSubscription = this.livekitService.participants$.subscribe(
      participants => this.participants = participants
    );
    
    this.connectedSubscription = this.livekitService.connected$.subscribe(
      connected => {
        this.connected = connected;
        
        // If connected and we have an auto-call phone number, initiate the call
        if (connected && this.autoCallPhoneNumber) {
          this.addLog(`Connected to room: ${this.roomName}`);
          setTimeout(() => {
            this.initiateCall(this.autoCallPhoneNumber!);
            this.autoCallPhoneNumber = null; // Clear it to prevent multiple calls
          }, 1000); // Small delay to ensure room is fully connected
        }
      }
    );
    
    this.activeCallSubscription = this.livekitService.activeCall$.subscribe(
      activeCall => {
        // If transitioning from inactive to active, record the start time
        if (!this.activeCall && activeCall) {
          this.callStartTime = new Date();
          this.addLog(`Call started at ${this.callStartTime.toLocaleTimeString()}`);
        }
        
        // If transitioning from active to inactive, clear the start time
        if (this.activeCall && !activeCall) {
          if (this.callStartTime) {
            const duration = this.getCallDurationSeconds();
            this.addLog(`Call ended. Duration: ${this.formatDuration(duration)}`);
          }
          this.callStartTime = null;
        }
        
        this.activeCall = activeCall;
        if (activeCall) {
          this.showPatientForm = false;
          this.addLog('Call is now active');
        } else if (!activeCall && this.connected) {
          this.addLog('Call has ended');
        }
      }
    );
    
    // Subscribe to connection state updates
    this.connectionStateSubscription = this.livekitService.connectionState$.subscribe(
      state => {
        this.connectionState = state;
        this.addLog(`Connection state changed: ${state}`);
      }
    );
    
    // Subscribe to logs from the LiveKit service
    this.logsSubscription = this.livekitService.logs$.subscribe(
      log => {
        this.addLog(log);
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
      this.addLog(`Initiating call to: ${phoneNumber}`);
      await this.livekitService.callPatient(this.roomName, phoneNumber);
      this.addLog('Call request sent to Twilio');
    } catch (error) {
      console.error('Failed to initiate call:', error);
      this.error = 'Failed to initiate call. Please try again.';
      this.addLog(`Error initiating call: ${error}`);
    }
  }

  async hangupCall(): Promise<void> {
    try {
      this.addLog('Hanging up call');
      await this.livekitService.hangupCall(this.roomName);
      this.addLog('Call has been terminated');
    } catch (error) {
      console.error('Failed to hang up call:', error);
      this.error = 'Failed to hang up call. Please try again.';
      this.addLog(`Error hanging up: ${error}`);
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
    this.addLog('Exiting room');
    this.livekitService.disconnect();
    this.router.navigate(['/dashboard']);
  }
  
  // Helper method to add timestamped logs
  addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.callLogs.push(`[${timestamp}] ${message}`);
    
    // Keep log size manageable
    if (this.callLogs.length > 100) {
      this.callLogs.shift();
    }
    
    console.log(`[Call Log] ${message}`);
  }
  
  /**
   * Checks if a participant is likely a SIP participant (i.e., phone caller)
   */
  isSipParticipant(participant: Participant): boolean {
    if (!participant || !participant.identity) return false;
    
    return participant.identity.includes('sip:') ||
           participant.identity.includes('phone:') ||
           participant.identity.includes('twilio') ||
           participant.identity.includes('+') ||
           /^\d+$/.test(participant.identity);
  }
  
  /**
   * Format a phone number for display
   */
  formatPhoneNumber(phoneIdentity: string): string {
    // Extract the actual phone number if it's in a complex format
    let phoneNumber = phoneIdentity;
    
    // Try to extract the phone number from common formats
    const phoneMatch = phoneIdentity.match(/\+?[0-9]{10,15}/);
    if (phoneMatch) {
      phoneNumber = phoneMatch[0];
    }
    
    // Format +1XXXXXXXXXX to +1 (XXX) XXX-XXXX
    if (phoneNumber.startsWith('+1') && phoneNumber.length === 12) {
      return `+1 (${phoneNumber.substr(2, 3)}) ${phoneNumber.substr(5, 3)}-${phoneNumber.substr(8, 4)}`;
    }
    
    // Format international numbers
    if (phoneNumber.startsWith('+') && phoneNumber.length > 8) {
      const countryCode = phoneNumber.substr(0, 3);
      const restOfNumber = phoneNumber.substr(3);
      return `${countryCode} ${restOfNumber}`;
    }
    
    // Just return the original if no formatting applied
    return phoneNumber;
  }
  
  /**
   * Calculate and return the call duration in seconds
   */
  getCallDurationSeconds(): number {
    if (!this.callStartTime) return 0;
    return Math.floor((new Date().getTime() - this.callStartTime.getTime()) / 1000);
  }
  
  /**
   * Format the call duration for display
   */
  getCallDuration(): string {
    const seconds = this.getCallDurationSeconds();
    return this.formatDuration(seconds);
  }
  
  /**
   * Format seconds into a readable duration string
   */
  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.participantsSubscription?.unsubscribe();
    this.connectedSubscription?.unsubscribe();
    this.activeCallSubscription?.unsubscribe();
    this.connectionStateSubscription?.unsubscribe();
    this.logsSubscription?.unsubscribe();
    
    // Disconnect from LiveKit
    this.livekitService.disconnect();
  }
}