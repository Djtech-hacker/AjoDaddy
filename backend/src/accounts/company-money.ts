// What the company wallet (userId 'SYSTEM') holds, and how much of it is really the company's.
// All amounts are kobo.

export async function readCompanyMoney(db: any) {
  const wallet = await db.wallet.findUnique({ where: { userId: 'SYSTEM' } });
  const balance: bigint = wallet?.balance ?? 0n;
  const escrow: bigint = wallet?.lockedBalance ?? 0n;
  const free = balance - escrow;

  // delivery money collected from customers
  const collected = await db.transaction.findMany({
    where: { userId: 'SYSTEM', type: 'WALLET_FUNDING', status: 'COMPLETED' },
    select: { amount: true, metadata: true },
  });
  let courier = 0n;
  let transfer = 0n;
  for (const row of collected) {
    const kind = (row.metadata as any)?.kind;
    if (kind === 'DELIVERY_COURIER') courier += row.amount;
    if (kind === 'DELIVERY_TRANSFER_FEE') transfer += row.amount;
  }

  // delivery money already paid out from the Accounts page
  const payouts = await db.transaction.findMany({
    where: { userId: 'SYSTEM', type: 'WITHDRAWAL', status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
    select: { amount: true, metadata: true },
  });
  let deliveryPaid = 0n;
  for (const row of payouts) {
    if ((row.metadata as any)?.category === 'DELIVERY') deliveryPaid += row.amount;
  }

  const stillOwed = courier + transfer - deliveryPaid;
  const owed = stillOwed > 0n ? stillOwed : 0n;
  return { walletId: wallet?.id as string | undefined, balance, escrow, free, courier, transfer, deliveryPaid, owed, own: free - owed };
}

// Same, but holds a row lock until the transaction ends, so two payments cannot both spend the same money.
export async function lockCompanyMoney(tx: any) {
  await tx.$queryRaw`SELECT id FROM wallets WHERE "userId" = 'SYSTEM' FOR UPDATE`;
  return readCompanyMoney(tx);
}
