import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../services/api.service';

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
    private apiService: ApiService
  ) {
    this.createRoomForm = this.fb.group({
      roomName: ['', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z0-9-_]+$')]]
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
    this.loading = true;
    
    this.apiService.createRoom(roomName).subscribe({
      next: () => {
        this.loading = false;
        this.createRoomForm.reset();
        this.loadRooms();
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

  logout(): void {
    localStorage.removeItem('agentName');
    this.router.navigate(['/login']);
  }
}