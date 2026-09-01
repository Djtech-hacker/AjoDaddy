// ============================================================
// ONE-TIME BACKFILL — totalContributed / totalReceived
// ============================================================
// makeContribution() and _executePayoutUnderLock() in groups.module.ts
// never updated User.totalContributed / User.totalReceived until the
// fix that added those increments — so every user's "Total Payouts"
// and "Contributed" on their profile showed ₦0 no matter how much real
// activity they had. That fix only counts activity going FORWARD.
//
// This script fixes the past: it sums every PAID contribution and every
// COMPLETED payout per user directly from the source tables, then SETS
// (never increments) each user's totals to that true sum. Because it
// always overwrites with a freshly recomputed number, it's safe to run
// more than once — running it twice can't double-count anything.
//
// Run once from the backend/ folder:
//   npx ts-node scripts/backfill-user-totals.ts
//
// (If ts-node isn't installed: npm install -D ts-node, then re-run.)
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Backfilling totalContributed from PAID contributions...');

  const contributionSums = await prisma.contribution.groupBy({
    by: ['userId'],
    where: { status: 'PAID' },
    _sum: { amount: true },
  });

  let contributedUpdated = 0;
  let contributedFailed = 0;
  for (const row of contributionSums) {
    const total = row._sum.amount ?? BigInt(0);
    try {
      await prisma.user.update({
        where: { id: row.userId },
        data: { totalContributed: total },
      });
      contributedUpdated++;
    } catch (err) {
      // Shouldn't normally happen (would mean a contribution points at
      // a userId with no matching User row) — log and keep going rather
      // than letting one bad row kill the whole backfill.
      console.error(`  Failed to update totalContributed for user ${row.userId}:`, err);
      contributedFailed++;
    }
  }
  console.log(`  Updated totalContributed for ${contributedUpdated} user(s).${contributedFailed ? ` (${contributedFailed} failed — see above)` : ''}`);

  console.log('Backfilling totalReceived from COMPLETED payouts...');

  const payoutSums = await prisma.payout.groupBy({
    by: ['recipientId'],
    where: { status: 'COMPLETED' },
    _sum: { amount: true },
  });

  let receivedUpdated = 0;
  let receivedFailed = 0;
  for (const row of payoutSums) {
    const total = row._sum.amount ?? BigInt(0);
    try {
      await prisma.user.update({
        where: { id: row.recipientId },
        data: { totalReceived: total },
      });
      receivedUpdated++;
    } catch (err) {
      console.error(`  Failed to update totalReceived for user ${row.recipientId}:`, err);
      receivedFailed++;
    }
  }
  console.log(`  Updated totalReceived for ${receivedUpdated} user(s).${receivedFailed ? ` (${receivedFailed} failed — see above)` : ''}`);

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });