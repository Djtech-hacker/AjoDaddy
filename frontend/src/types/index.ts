// ============================================================
// PAYPADDY — Shared TypeScript Types
// ============================================================

export type UserRole   = 'USER' | 'ADMIN' | 'SUPER_ADMIN' | 'CUSTOMER_SERVICE'
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_VERIFICATION'

export interface User {
  id:               string
  email:            string
  username:         string
  firstName:        string
  lastName:         string
  phone?:           string
  avatarUrl?:       string
  bio?:             string
  role:             UserRole
  status:           UserStatus
  isEmailVerified:  boolean
  hasTransactionPin: boolean
  reputationScore:  number
  currentStreak:    number
  longestStreak:    number
  totalContributed: number
  totalReceived:    number
  referralCode:     string
  createdAt:        string
  badges?:          UserBadge[]
  stats?: {
    groupsOwned:       number
    groupsJoined:      number
    contributionsMade: number
  }
}

export interface UserBadge {
  type:     string
  earnedAt: string
  details?: { label: string; description: string; icon: string; color: string }
}

// ── Groups ─────────────────────────────────────────────────

export type GroupStatus      = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'DRAFT'
export type GroupVisibility  = 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY'
export type ContributionFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'

export interface Group {
  id:                  string
  slug:                string
  name:                string
  description?:        string
  bannerUrl?:          string
  ownerId:             string
  owner:               Pick<User, 'id' | 'username' | 'firstName' | 'lastName' | 'avatarUrl'>
  status:              GroupStatus
  visibility:          GroupVisibility
  contributionAmount:  number
  frequency:           ContributionFrequency
  payoutFrequency:     ContributionFrequency
  maxMembers:          number
  currentCycle:        number
  totalCycles:         number
  deadlineDays:        number
  penaltyAmount:       number
  chatEnabled:         boolean
  leaderboardEnabled:  boolean
  inviteCode:          string
  startDate:           string
  nextContributionDate?: string
  memberCount:         number
  createdAt:           string
  myMembership?:       GroupMember | null
  // ── populated by detail endpoint ──
  members?:            GroupMember[]
  contributions?:      Contribution[]
  nextPayout?: {
    id:            string
    amount:        number
    status:        PayoutStatus
    scheduledDate: string
    cycleNumber:   number
    recipient?: Pick<User, 'id' | 'firstName' | 'lastName' | 'avatarUrl'>
  }
}

export interface GroupMember {
  id:             string
  groupId:        string
  userId:         string
  role:           'ADMIN' | 'MODERATOR' | 'MEMBER'
  status:         'ACTIVE' | 'SUSPENDED' | 'REMOVED' | 'PENDING'
  payoutPosition: number
  totalPaid:      number
  missedCount:    number
  joinedAt:       string
  user:           Pick<User, 'id' | 'username' | 'firstName' | 'lastName' | 'avatarUrl' | 'reputationScore'>
}

// ── Contributions ───────────────────────────────────────────

export type ContributionStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'PARTIAL'

export interface Contribution {
  id:             string
  groupId:        string
  userId:         string
  cycleNumber:    number
  amount:         number
  status:         ContributionStatus
  dueDate:        string
  paidAt?:        string
  penaltyApplied: number
  group?:         Pick<Group, 'id' | 'name' | 'slug'>
  user?:          Pick<User, 'firstName' | 'username' | 'avatarUrl'>
}

// ── Payouts ─────────────────────────────────────────────────

export type PayoutStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface Payout {
  id:            string
  groupId:       string
  recipientId:   string
  cycleNumber:   number
  amount:        number
  status:        PayoutStatus
  scheduledDate: string
  processedAt?:  string
  group?:        Pick<Group, 'name'>
  recipient?:    Pick<User, 'firstName' | 'lastName' | 'avatarUrl'>
}

// ── Wallet & Transactions ───────────────────────────────────

export type TransactionType   = 'WALLET_FUNDING' | 'CONTRIBUTION' | 'PAYOUT' | 'WITHDRAWAL' | 'REFUND' | 'PENALTY' | 'REVERSAL'
export type TransactionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED'

export interface Wallet {
  id:               string
  balance:          number
  lockedBalance:    number
  availableBalance: number
  currency:         string
  isActive:         boolean
}

export interface Transaction {
  id:            string
  type:          TransactionType
  status:        TransactionStatus
  amount:        number
  fee:           number
  balanceBefore: number
  balanceAfter:  number
  currency:      string
  reference:     string
  description?:  string
  createdAt:     string
}

// ── Notifications ───────────────────────────────────────────

export type NotificationType =
  | 'CONTRIBUTION_DUE' | 'CONTRIBUTION_RECEIVED'
  | 'PAYOUT_SCHEDULED' | 'PAYOUT_COMPLETED'
  | 'WALLET_FUNDED'    | 'WALLET_WITHDRAWAL'
  | 'GROUP_INVITE'     | 'GROUP_JOIN_APPROVED'
  | 'MEMBER_JOINED'    | 'MEMBER_LEFT'
  | 'OVERDUE_WARNING'  | 'PENALTY_APPLIED'
  | 'BADGE_EARNED'     | 'SYSTEM'

export interface Notification {
  id:        string
  userId:    string
  type:      NotificationType
  title:     string
  body:      string
  data?:     Record<string, any>
  isRead:    boolean
  readAt?:   string
  createdAt: string
}

// ── Chat ────────────────────────────────────────────────────

export type MessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM'

export interface ChatMessage {
  id:        string
  groupId:   string
  senderId:  string
  type:      MessageType
  content?:  string
  fileUrl?:  string
  fileName?: string
  replyToId?: string
  isDeleted: boolean
  createdAt: string
  sender:    Pick<User, 'id' | 'username' | 'firstName' | 'avatarUrl'>
}

// ── Analytics ───────────────────────────────────────────────

export interface DashboardSummary {
  wallet:               Wallet
  groups:               Array<GroupMember & { group: Group }>
  recentContributions:  Contribution[]
  upcomingPayouts:      Payout[]
  pendingContributions: Contribution[]
  gamification: {
    currentStreak:   number
    longestStreak:   number
    reputationScore: number
    badgeCount:      number
  }
  totals: {
    transactionCount: number
    totalTransacted:  number
  }
}

export interface TrendPoint {
  week:  string
  total: number
  count: number
}

export interface Insight {
  type:    'positive' | 'warning' | 'info'
  icon:    string
  title:   string
  message: string
}

// ── API Response wrappers ───────────────────────────────────

export interface ApiResponse<T> {
  success: boolean
  data:    T
  message?: string
}

export interface PaginatedResponse<T> {
  data:    T[]
  pagination: {
    page:       number
    limit:      number
    total:      number
    totalPages: number
  }
}