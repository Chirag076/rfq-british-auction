import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class SubmitBidDto {
  @IsUUID()
  supplierId: string;

  @IsString()
  carrierName: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  freightCharges: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  originCharges: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  destinationCharges: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  transitTimeDays: number;

  @IsDateString()
  validUntil: string;
}
