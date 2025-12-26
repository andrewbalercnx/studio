import { NextRequest, NextResponse } from 'next/server';
import { getServerFirestore } from '@/lib/server-firestore';
import { requireAdminUser } from '@/lib/server-auth';

export type TokenUsageByParent = {
  parentId: string;
  email?: string;
  day: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    thoughtsTokens: number;
    flowCount: number;
  };
  month: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    thoughtsTokens: number;
    flowCount: number;
  };
};

export type TokenUsageResponse = {
  ok: true;
  data: TokenUsageByParent[];
  totals: {
    day: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
    month: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
  };
} | {
  ok: false;
  error: string;
};

export async function GET(request: NextRequest): Promise<NextResponse<TokenUsageResponse>> {
  try {
    // Require admin authentication
    await requireAdminUser(request);

    const firestore = await getServerFirestore();

    // Calculate time boundaries
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Query AI flow logs from the past month (we'll filter day vs month in code)
    const logsSnapshot = await firestore
      .collection('aiFlowLogs')
      .where('createdAt', '>=', oneMonthAgo)
      .where('status', '==', 'success')
      .get();

    // Aggregate by parentId
    const usageMap = new Map<string, {
      day: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
      month: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
    }>();

    const totals = {
      day: { inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtsTokens: 0, flowCount: 0 },
      month: { inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtsTokens: 0, flowCount: 0 },
    };

    logsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const parentId = data.parentId;

      // Skip logs without parentId
      if (!parentId) return;

      const usage = data.usage;
      if (!usage) return;

      const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);
      const isWithinDay = createdAt >= oneDayAgo;

      // Initialize entry if needed
      if (!usageMap.has(parentId)) {
        usageMap.set(parentId, {
          day: { inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtsTokens: 0, flowCount: 0 },
          month: { inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtsTokens: 0, flowCount: 0 },
        });
      }

      const entry = usageMap.get(parentId)!;

      // Add to month totals (all logs are within month by query)
      entry.month.inputTokens += usage.inputTokens || 0;
      entry.month.outputTokens += usage.outputTokens || 0;
      entry.month.totalTokens += usage.totalTokens || 0;
      entry.month.thoughtsTokens += usage.thoughtsTokens || 0;
      entry.month.flowCount += 1;

      totals.month.inputTokens += usage.inputTokens || 0;
      totals.month.outputTokens += usage.outputTokens || 0;
      totals.month.totalTokens += usage.totalTokens || 0;
      totals.month.thoughtsTokens += usage.thoughtsTokens || 0;
      totals.month.flowCount += 1;

      // Add to day totals if within last 24 hours
      if (isWithinDay) {
        entry.day.inputTokens += usage.inputTokens || 0;
        entry.day.outputTokens += usage.outputTokens || 0;
        entry.day.totalTokens += usage.totalTokens || 0;
        entry.day.thoughtsTokens += usage.thoughtsTokens || 0;
        entry.day.flowCount += 1;

        totals.day.inputTokens += usage.inputTokens || 0;
        totals.day.outputTokens += usage.outputTokens || 0;
        totals.day.totalTokens += usage.totalTokens || 0;
        totals.day.thoughtsTokens += usage.thoughtsTokens || 0;
        totals.day.flowCount += 1;
      }
    });

    // Get user emails for parent IDs
    const parentIds = Array.from(usageMap.keys());
    const emailMap = new Map<string, string>();

    if (parentIds.length > 0) {
      // Firestore limits 'in' queries to 30 items, so batch if needed
      const batches: string[][] = [];
      for (let i = 0; i < parentIds.length; i += 30) {
        batches.push(parentIds.slice(i, i + 30));
      }

      for (const batch of batches) {
        const usersSnapshot = await firestore
          .collection('users')
          .where('__name__', 'in', batch)
          .get();

        usersSnapshot.docs.forEach(doc => {
          const userData = doc.data();
          if (userData.email) {
            emailMap.set(doc.id, userData.email);
          }
        });
      }
    }

    // Build response array sorted by month total tokens (descending)
    const data: TokenUsageByParent[] = Array.from(usageMap.entries())
      .map(([parentId, usage]) => ({
        parentId,
        email: emailMap.get(parentId),
        day: usage.day,
        month: usage.month,
      }))
      .sort((a, b) => b.month.totalTokens - a.month.totalTokens);

    return NextResponse.json({ ok: true, data, totals });

  } catch (error: any) {
    console.error('[token-usage] Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
