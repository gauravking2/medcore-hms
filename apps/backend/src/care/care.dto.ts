import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateLabTestDto {
  @IsString()
  @MaxLength(128)
  name!: string;

  @IsString()
  @MaxLength(32)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  referenceRange?: string;

  @IsOptional()
  @IsNumber()
  rangeLow?: number;

  @IsOptional()
  @IsNumber()
  rangeHigh?: number;
}

export class UpdateLabTestDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  referenceRange?: string;

  @IsOptional()
  @IsNumber()
  rangeLow?: number;

  @IsOptional()
  @IsNumber()
  rangeHigh?: number;

  @IsOptional()
  isActive?: boolean;
}

export class CreateLabOrderDto {
  @IsString()
  medicalRecordId!: string;

  @IsString()
  labTestId!: string;
}

export class UpdateLabOrderStatusDto {
  @IsIn(['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_UPLOADED', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status!: 'ORDERED' | 'SAMPLE_COLLECTED' | 'PROCESSING' | 'RESULT_UPLOADED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

export class UploadLabResultDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resultValue?: string;

  @IsOptional()
  @IsNumber()
  resultNumeric?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  resultUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  resultNotes?: string;
}

export class CreateMedicineDto {
  @IsString()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  genericName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dosageForm?: string;

  @IsString()
  @MaxLength(64)
  sku!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;
}

export class UpdateMedicineDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  genericName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dosageForm?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  isActive?: boolean;
}

export class CreateBatchDto {
  @IsString()
  medicineId!: string;

  @IsString()
  @MaxLength(64)
  batchNumber!: string;

  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @IsDateString()
  expiryDate!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsNumber()
  @Min(0)
  mrp!: number;
}

export class DispenseDto {
  @IsString()
  medicineId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;
}

export class QuarantineDto {
  @IsOptional()
  quarantined?: boolean;
}
