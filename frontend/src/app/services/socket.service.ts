import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;

  constructor() {
    this.socket = io(environment.apiUrl, {
      transports: ['websocket', 'polling']
    });
    
    this.socket.on('connect', () => {
      console.log('Connected to socket server');
    });
    
    this.socket.on('disconnect', () => {
      console.log('Disconnected from socket server');
    });
    
    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });
  }

  // Join a specific room
  joinRoom(roomName: string): void {
    this.socket.emit('join-room', roomName);
    console.log(`Joined room: ${roomName}`);
  }

  // Leave a specific room
  leaveRoom(roomName: string): void {
    this.socket.emit('leave-room', roomName);
    console.log(`Left room: ${roomName}`);
  }

  // Send a message from the patient to the AI agent
  sendPatientMessage(roomName: string, message: string, patientName: string): void {
    this.socket.emit('patient-message', {
      roomName,
      message,
      patientName
    });
  }

  // Listen for AI agent messages
  onAgentMessage(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('agent-message', (data: any) => {
        observer.next(data);
      });
      
      return () => {
        this.socket.off('agent-message');
      };
    });
  }

  // Listen for error messages
  onError(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('error', (data: any) => {
        observer.next(data);
      });
      
      return () => {
        this.socket.off('error');
      };
    });
  }

  // Disconnect from the socket server
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}