import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Throttle } from '@nestjs/throttler'
import { BankAccountsService } from './bank-accounts.service'
import { AddBankAccountDto, PinDto, ResolveAccountDto } from './bank-accounts.dto'

const uid = (req: any): string => req.user?.id ?? req.user?.sub ?? req.user?.userId

@Controller('bank-accounts')
@UseGuards(AuthGuard('jwt'))
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  list(@Req() req: any) { return this.service.list(uid(req)) }

  @Post('resolve')
  @HttpCode(200)
  @Throttle({ long: { limit: 6, ttl: 60_000 } })
  resolve(@Req() req: any, @Body() dto: ResolveAccountDto) {
    return this.service.resolve(uid(req), dto.bankCode, dto.accountNumber)
  }

  @Post()
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  add(@Req() req: any, @Body() dto: AddBankAccountDto) {
    return this.service.add(uid(req), dto.bankCode, dto.accountNumber, dto.pin)
  }

  @Patch(':id/default')
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  setDefault(@Req() req: any, @Param('id') id: string, @Body() dto: PinDto) {
    return this.service.setDefault(uid(req), id, dto.pin)
  }

  @Delete(':id')
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  remove(@Req() req: any, @Param('id') id: string, @Body() dto: PinDto) {
    return this.service.remove(uid(req), id, dto.pin)
  }
}