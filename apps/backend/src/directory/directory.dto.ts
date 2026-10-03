import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_MESSAGE = 'Password must be 8-72 chars with upper, lower, digit, and special character.';

export class AddressInput {
  @IsString()
  @MaxLength(128)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  line2?: string;

  @IsString()
  @MaxLength(64)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  postalCode?: string;

  @IsString()
  @MaxLength(64)
  country!: string;
}

export class CreateHospitalDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug must be lowercase alphanumeric with dashes.' })
  @MaxLength(64)
  slug!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  address?: AddressInput;
}

export class UpdateHospitalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class UpdateStatusDto {
  @IsIn(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status!: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name!: string;

  @IsString()
  @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'Code must be 2-32 uppercase letters, digits, or dashes.' })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsIn([true, false])
  isActive?: boolean;
}

export const STAFF_ROLES = ['HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT'] as const;

void STAFF_ROLES;

export class CreateDoctorDto {
  @IsString()
  @MinLength(1)
  hospitalId!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  licenseNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  specialization!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  bio?: string;

  @IsOptional()
  consultationFee?: number;

  @IsOptional()
  @IsString({ each: true })
  departmentIds?: string[];
}

export class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  specialization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  bio?: string;

  @IsOptional()
  consultationFee?: number;

  @IsOptional()
  @IsString({ each: true })
  departmentIds?: string[];
}

export class InviteStaffDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsString()
  role!: string;

  @IsString()
  @MinLength(1)
  hospitalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;
}

export class UpdateRoleDto {
  @IsString()
  role!: string;
}

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  hospitalId!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/, { message: PASSWORD_MESSAGE })
  password?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  lastName!: string;

  @IsOptional()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED'])
  gender?: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  emergencyContactPhone?: string;
}

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  emergencyContactPhone?: string;
}
