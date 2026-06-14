/**
 * 派单系统核心类型定义
 */

// ==================== 枚举 ====================

export enum CustomerType {
  FIRST_VISIT = 'FIRST_VISIT',
  PROJECT = 'PROJECT',
  FOLLOW_UP = 'FOLLOW_UP',
}

export enum TimeSlot {
  MORNING = 'MORNING',
  AFTERNOON_1 = 'AFTERNOON_1',
  AFTERNOON_2 = 'AFTERNOON_2',
}

export enum EmployeeRole {
  FRONT = 'FRONT',
  PROJECT = 'PROJECT',
  BACK = 'BACK',
}

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  LEAVE = 'LEAVE',
}

export enum DispatchStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum FrontProjectMode {
  CROSS_TYPE = 'CROSS_TYPE',
  SAME_TYPE = 'SAME_TYPE',
  RANDOM = 'RANDOM',
}

export enum PlusLevel {
  PLUS_0 = 'Plus0',
  PLUS_1 = 'Plus1',
  PLUS_N = 'PlusN',
}

// ==================== 实体接口 ====================

export interface City {
  id: number;
  name: string;
  code?: string;
}

export interface InvestmentPark {
  id: number;
  name: string;
  cityId: number;
  cityName: string;
  address?: string;
  contact?: string;
  phone?: string;
  status?: string;
}

export interface PlusCapabilities {
  FRONT?: PlusLevel[];
  PROJECT?: PlusLevel[];
  BACK?: PlusLevel[];
}

/** 员工基础信息（派单前主数据，非派单结果） */
export interface Employee {
  id: number;
  name: string;
  cityId: number;
  cityName: string;
  /** 负责服务的园区ID（派单规则匹配用，员工不「属于」园区） */
  serviceParkId: number;
  serviceParkName: string;
  roles: EmployeeRole[];
  status: EmployeeStatus;
  departureAddress: string;
  plusCapabilities: PlusCapabilities;
  orderCapacity: TimeSlot[];
  remark?: string;
}

/** 待派单客户（派单前主数据） */
export interface Customer {
  id: number;
  companyName: string;
  address: string;
  customerType: CustomerType;
  appointmentTime: Date;
  timeSlot: TimeSlot;
  cityId: number;
  cityName: string;
  /** 客户所属招商园区 */
  parkId: number;
  parkName: string;
  plusCount: number;
  plusLevel: PlusLevel;
  designatedPerson?: string;
  rejectedPerson?: string;
  isHandInHand: boolean;
  handInHandGroup?: string;
  remark?: string;
  dispatchStatus: DispatchStatus;
}

/** 派单后：单条客户→员工分配记录 */
export interface DispatchResult {
  customerId: number;
  customerName: string;
  employeeId: number;
  employeeName: string;
  timeSlot: TimeSlot;
  customerType: CustomerType;
  commuteMinutes?: number;
  matchScore: number;
  matchDetails: MatchDetail[];
}

/** 派单后：员工派单信息表（每位员工当天汇总） */
export interface DispatchEmployeeSheet {
  employeeId: number;
  employeeName: string;
  serviceParkName: string;
  totalOrders: number;
  morningOrders: number;
  afternoon1Orders: number;
  afternoon2Orders: number;
  totalCommuteMinutes: number;
  orders: {
    companyName: string;
    timeSlot: string;
    customerType: string;
    address: string;
    commuteMinutes?: number;
  }[];
}

export interface MatchDetail {
  rule: string;
  passed: boolean;
  message: string;
}

export interface DispatchBatch {
  id: number;
  batchDate: Date;
  frontProjectMode: FrontProjectMode;
  totalCustomers: number;
  totalEmployees: number;
  results: DispatchResult[];
  statistics: DispatchStatistics;
}

export interface DispatchStatistics {
  totalAssigned: number;
  byTimeSlot: Record<TimeSlot, number>;
  byCustomerType: Record<CustomerType, number>;
  avgCommuteMinutes: number;
  maxCommuteMinutes: number;
  handInHandGroups: number;
}

export interface DispatchConfig {
  frontProjectMode: FrontProjectMode;
  maxTotalCommuteMinutes: number;
  maxMorningCommuteMinutes: number;
  maxAfternoonCommuteMinutes: number;
  maxAfternoon2CommuteMinutes: number;
  enableDistanceOptimization: boolean;
  allowCommuteOverridePlus: boolean;
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  frontProjectMode: FrontProjectMode.RANDOM,
  maxTotalCommuteMinutes: 240,
  maxMorningCommuteMinutes: 180,
  maxAfternoonCommuteMinutes: 210,
  maxAfternoon2CommuteMinutes: 60,
  enableDistanceOptimization: true,
  allowCommuteOverridePlus: true,
};

export interface DispatchContext {
  customers: Customer[];
  employees: Employee[];
  config: DispatchConfig;
  assignments: Map<number, Customer[]>;
  pendingCustomers: Customer[];
  availableEmployees: Employee[];
  results: DispatchResult[];
}

export interface ExcelCustomerRow {
  companyName: string;
  appointmentTime: string;
  address: string;
  parkName: string;
  plusCount: string;
  designatedPerson?: string;
  rejectedPerson?: string;
  remark?: string;
}

export interface ExcelEmployeeRow {
  name: string;
  cityName: string;
  serviceParkName: string;  // Excel列名仍为「招商园区」，语义为负责服务的园区
  roles: string;
  status: string;
  departureAddress: string;
  plusCapabilities: string;
  orderCapacity: string;
  remark?: string;
}

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  [CustomerType.FIRST_VISIT]: '首访（前道）',
  [CustomerType.PROJECT]: '项目',
  [CustomerType.FOLLOW_UP]: '回访（后道）',
};

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  [TimeSlot.MORNING]: '上午',
  [TimeSlot.AFTERNOON_1]: '下午1',
  [TimeSlot.AFTERNOON_2]: '下午2',
};

export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  [EmployeeRole.FRONT]: '前道',
  [EmployeeRole.PROJECT]: '项目',
  [EmployeeRole.BACK]: '后道',
};

export const FRONT_PROJECT_MODE_LABELS: Record<FrontProjectMode, string> = {
  [FrontProjectMode.CROSS_TYPE]: '交叉类型（上午前道+下午项目）',
  [FrontProjectMode.SAME_TYPE]: '同类型（上下午相同类型）',
  [FrontProjectMode.RANDOM]: '随机分配',
};
