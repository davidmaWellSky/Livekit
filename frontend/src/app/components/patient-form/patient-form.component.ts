import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-patient-form',
  templateUrl: './patient-form.component.html',
  styleUrls: ['./patient-form.component.scss']
})
export class PatientFormComponent {
  @Input() roomName: string = '';
  @Output() initiateCall = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  patientForm: FormGroup;
  submitting = false;

  constructor(private fb: FormBuilder) {
    this.patientForm = this.fb.group({
      phoneNumber: ['', [
        Validators.required, 
        Validators.pattern('^\\+?[1-9]\\d{1,14}$') // E.164 format validation
      ]]
    });
  }

  onSubmit(): void {
    if (this.patientForm.invalid) {
      return;
    }

    this.submitting = true;
    const phoneNumber = this.patientForm.get('phoneNumber')?.value;
    
    // Emit the phone number to parent component
    this.initiateCall.emit(phoneNumber);
    
    // Reset form
    this.patientForm.reset();
    this.submitting = false;
  }

  onCancel(): void {
    this.cancel.emit();
  }
}