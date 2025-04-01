import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { LivekitService } from '../../services/livekit.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  agentName: string = '';
  rooms: any[] = [];
  loading: boolean = false;
  error: string = '';
  createRoomForm: FormGroup;

  constructor(
    private router: Router,
    private fb: FormBuilder,
    private apiService: ApiService,
    private livekitService: LivekitService
  ) {
    // Generate a random room name
    const randomRoomName = this.generateRandomRoomName();
    
    this.createRoomForm = this.fb.group({
      roomName: [randomRoomName, [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z0-9-_]+$')]],
      phoneNumber: ['', [Validators.required, Validators.pattern('^\\+?[1-9]\\d{1,14}$')]]
    });
  }

  ngOnInit(): void {
    // Generate a random agent name - no login required
    const agentName = `Agent-${Math.floor(Math.random() * 1000)}`;
    localStorage.setItem('agentName', agentName);
    this.agentName = agentName;
    
    // Check if there's a stored agent name, but this is just a fallback
    if (!this.agentName) {
      this.router.navigate(['/login']);
      return;
    }
    
    this.loadRooms();
  }

  loadRooms(): void {
    this.loading = true;
    this.error = '';
    
    this.apiService.listRooms().subscribe({
      next: (response) => {
        this.rooms = response.rooms || [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load rooms:', err);
        this.error = 'Failed to load rooms. Please try again.';
        this.loading = false;
      }
    });
  }

  createRoom(): void {
    if (this.createRoomForm.invalid) {
      return;
    }

    const roomName = this.createRoomForm.get('roomName')?.value;
    const phoneNumber = this.createRoomForm.get('phoneNumber')?.value;
    this.loading = true;
    
    // Create a room and then automatically join it and initiate call
    this.apiService.createRoom(roomName).subscribe({
      next: () => {
        // Add logging
        console.log(`Creating room: ${roomName} and calling: ${phoneNumber}`);
        
        // Navigate to the call component which will automatically connect to the room
        this.router.navigate(['/call', roomName], {
          state: {
            autoCall: true,
            phoneNumber: phoneNumber
          }
        });
        
        this.loading = false;
        this.createRoomForm.reset();
      },
      error: (err) => {
        console.error('Failed to create room:', err);
        this.error = 'Failed to create room. Please try again.';
        this.loading = false;
      }
    });
  }

  joinRoom(roomName: string): void {
    this.router.navigate(['/call', roomName]);
  }

  /**
   * Regenerates the room name with a new random value
   */
  regenerateRoomName(): void {
    const newRoomName = this.generateRandomRoomName();
    this.createRoomForm.get('roomName')?.setValue(newRoomName);
  }

  logout(): void {
    localStorage.removeItem('agentName');
    this.router.navigate(['/login']);
  }

  /**
   * Generates a random room name with a descriptive prefix and numeric suffix
   * Format: [purpose]-[timestamp]-[random]
   */
  private generateRandomRoomName(): string {
    const prefixes = ['call', 'meeting', 'appointment', 'consult'];
    const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const timestamp = new Date().getTime().toString().slice(-6); // Last 6 digits of timestamp
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `${randomPrefix}-${timestamp}-${randomNum}`;
  }
}