import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum ExtensionTriggerDto {
  BID_RECEIVED = 'BID_RECEIVED',
  ANY_RANK_CHANGE = 'ANY_RANK_CHANGE',
  L1_CHANGE = 'L1_CHANGE',
}

export class CreateRfqDto {
  @IsString() reference: string;
  @IsString() name: string;

  @IsDateString() bidStartAt: string;
  @IsDateString() bidCloseAt: string;
  @IsDateString() forcedCloseAt: string;
  @IsDateString() pickupDate: string;

  @IsOptional() @IsBoolean() britishAuction?: boolean;

  /// X. Capped rather than unbounded: a trigger window longer than the auction
  /// means every bid extends, which is not a British auction any more.
  @IsInt() @Min(1) @Max(1440) @Type(() => Number) triggerWindowMinutes: number;

  /// Y.
  @IsInt() @Min(1) @Max(1440) @Type(() => Number) extensionMinutes: number;

  @IsEnum(ExtensionTriggerDto) trigger: ExtensionTriggerDto;
}
