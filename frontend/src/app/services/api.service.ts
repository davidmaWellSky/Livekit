import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  // Token generation for LiveKit
  getToken(identity: string, room: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/token`, { identity, room });
  }

  // Room management
  listRooms(): Observable<any> {
    return this.http.get(`${this.baseUrl}/rooms`);
  }

  createRoom(name: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/rooms`, { name });
  }

  // SIP call functionality
  initiateCall(room: string, phoneNumber: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/call`, { room, phoneNumber });
  }

  hangupCall(room: string, participantId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/hangup`, { room, participantId });
  }

  // Get call status for a room
  getActiveCall(room: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/call-status/${room}`);
  }
}