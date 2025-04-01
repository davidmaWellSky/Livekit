import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { SocketService } from '../../services/socket.service';
import { Subscription } from 'rxjs';

interface ChatMessage {
  sender: string;
  message: string;
  timestamp: string;
  isAgent: boolean;
}

@Component({
  selector: 'app-agent-chat',
  templateUrl: './agent-chat.component.html',
  styleUrls: ['./agent-chat.component.scss']
})
export class AgentChatComponent implements OnInit, OnDestroy {
  @Input() roomName: string = '';
  @Input() patientName: string = 'Patient';
  
  messages: ChatMessage[] = [];
  newMessage: string = '';
  private messageSubscription?: Subscription;
  
  constructor(private socketService: SocketService) {}
  
  ngOnInit(): void {
    // Join the room's socket channel
    this.socketService.joinRoom(this.roomName);
    
    // Listen for agent messages
    this.messageSubscription = this.socketService.onAgentMessage().subscribe(
      (data: any) => {
        this.messages.push({
          sender: data.agentName,
          message: data.message,
          timestamp: data.timestamp,
          isAgent: true
        });
      }
    );
    
    // Add a welcome message
    this.messages.push({
      sender: 'GeminiAgent',
      message: 'Hello! I\'m your healthcare scheduling assistant. How can I help you schedule an appointment today?',
      timestamp: new Date().toISOString(),
      isAgent: true
    });
  }
  
  sendMessage(): void {
    if (!this.newMessage.trim()) return;
    
    // Add message to local display
    this.messages.push({
      sender: this.patientName,
      message: this.newMessage,
      timestamp: new Date().toISOString(),
      isAgent: false
    });
    
    // Send to backend
    this.socketService.sendPatientMessage(
      this.roomName,
      this.newMessage,
      this.patientName
    );
    
    // Clear input
    this.newMessage = '';
  }
  
  ngOnDestroy(): void {
    // Leave the room and clean up
    this.socketService.leaveRoom(this.roomName);
    this.messageSubscription?.unsubscribe();
  }
}