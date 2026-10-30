import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Use AFTER JwtAuthGuard:  @UseGuards(JwtAuthGuard, VendorActiveGuard)
// Lets the request through only if the user has an ACTIVE VendorProfile.
// Suspended or not-yet-approved users get a clear 403 message.
@Injectable()
export class VendorActiveGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Please log in.');

    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { status: true, businessName: true },
    });
    if (!profile) throw new ForbiddenException('You are not a vendor yet. Apply to become one first.');
    if (profile.status !== 'ACTIVE') throw new ForbiddenException('Your vendor account is suspended. Contact support.');

    req.vendor = { userId, businessName: profile.businessName };
    return true;
  }
}