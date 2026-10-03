import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateEmrDto {
  @IsString()
  appointmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  presentingSymptoms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  differentialDiagnosis?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  diagnosis?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icd10Code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  treatmentPlan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  treatmentInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  clinicalNotes?: string;
}

export class AppendEmrEntryDto {
  @IsIn(['NOTE', 'DIAGNOSIS', 'TREATMENT', 'ALLERGY', 'MEDICATION_HISTORY', 'VACCINATION', 'FAMILY_HISTORY'])
  entryType!: 'NOTE' | 'DIAGNOSIS' | 'TREATMENT' | 'ALLERGY' | 'MEDICATION_HISTORY' | 'VACCINATION' | 'FAMILY_HISTORY';

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  allergies?: unknown;

  @IsOptional()
  medicationHistory?: unknown;

  @IsOptional()
  vaccinations?: Array<{ date?: string; vaccineName?: string; batchNumber?: string; nextDueDate?: string }>;

  @IsOptional()
  familyHistory?: { diabetes?: boolean; hypertension?: boolean; cancer?: boolean; cardiac?: boolean };
}

export class RecordVitalsDto {
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(300)
  systolicBp?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(200)
  diastolicBp?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  pulse?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(45)
  temperatureCelsius?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(100)
  spo2?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(400)
  weightKg?: number;
}

export class CreatePrescriptionDto {
  @IsString()
  medicalRecordId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  notes?: string;

  @IsArray()
  items!: Array<{
    medicineId: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity?: number;
    specialInstructions?: string;
  }>;
}

export class PatientHistoryDto {
  @IsOptional()
  @IsArray()
  allergies?: string[];

  @IsOptional()
  @IsArray()
  adverseDrugReactions?: string[];

  @IsOptional()
  @IsArray()
  medicationHistory?: string[];

  @IsOptional()
  @IsArray()
  vaccinations?: Array<{ date?: string; vaccineName?: string; batchNumber?: string; nextDueDate?: string }>;

  @IsOptional()
  familyHistory?: { diabetes?: boolean; hypertension?: boolean; cancer?: boolean; cardiac?: boolean };
}

export class FamilyHistoryDto {
  @IsOptional()
  @IsBoolean()
  diabetes?: boolean;

  @IsOptional()
  @IsBoolean()
  hypertension?: boolean;

  @IsOptional()
  @IsBoolean()
  cancer?: boolean;

  @IsOptional()
  @IsBoolean()
  cardiac?: boolean;
}

export class VaccinationDto {
  @IsDateString()
  date!: string;

  @IsString()
  @MaxLength(128)
  vaccineName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;
}
