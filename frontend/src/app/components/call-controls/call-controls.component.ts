import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-call-controls',
  templateUrl: './call-controls.component.html',
  styleUrls: ['./call-controls.component.scss']
})
export class CallControlsComponent {
  @Output() hangupCall = new EventEmitter<void>();
  
  // Call timer properties
  callStartTime: Date = new Date();
  currentTime: string = '00:00';
  timerInterval: any;

  constructor() {
    // Start call timer
    this.callStartTime = new Date();
    this.startTimer();
  }

  onHangup(): void {
    this.hangupCall.emit();
    this.stopTimer();
  }

  private startTimer(): void {
    this.timerInterval = setInterval(() => {
      const now = new Date();
      const diff = now.getTime() - this.callStartTime.getTime();
      
      // Format the time difference as mm:ss
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      
      this.currentTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}