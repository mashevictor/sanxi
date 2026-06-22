/**
 * 全量演示数据：5 园区 × 5 员工 × 每人 2 单（上午+下午），保证 100% 合规匹配
 */

import {
  Customer,
  Employee,
  InvestmentPark,
  CustomerType,
  TimeSlot,
  EmployeeRole,
  EmployeeStatus,
  PlusLevel,
  DispatchStatus,
  PlusCapabilities,
} from '../types';
import { ImportResult } from '../services/excel-importer';

function dt(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

export function buildShowcaseData(): ImportResult {
  const parks: InvestmentPark[] = [
    { id: 1, name: '加盟-金山资本现代产业园', cityId: 1, cityName: '上海市', address: '上海市金山区亭林镇产业园路1号' },
    { id: 2, name: '宝山高新', cityId: 1, cityName: '上海市', address: '上海市宝山区淞发路25号' },
    { id: 3, name: '山东济南', cityId: 1, cityName: '上海市', address: '山东省济南市高新区' },
    { id: 4, name: '江苏徐州', cityId: 1, cityName: '上海市', address: '江苏省徐州市云龙区' },
    { id: 5, name: '江苏镇江', cityId: 1, cityName: '上海市', address: '江苏省镇江市京口区' },
  ];

  /** 演示员工姓名带「演示-」前缀，避免与 Excel 存量员工同名 */
  const employees: Employee[] = [
    {
      id: 1, name: '演示-范金山', cityId: 1, cityName: '上海市',
      roles: [EmployeeRole.BACK], status: EmployeeStatus.ACTIVE,
      departureAddress: '上海市金山区亭林镇',
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      plusCapabilities: { BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N] } as PlusCapabilities,
      serviceParkId: 1, serviceParkName: '加盟-金山资本现代产业园', remark: '',
    },
    {
      id: 2, name: '演示-顾宝山', cityId: 1, cityName: '上海市',
      roles: [EmployeeRole.BACK], status: EmployeeStatus.ACTIVE,
      departureAddress: '上海市宝山区淞发路',
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      plusCapabilities: { BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N] } as PlusCapabilities,
      serviceParkId: 2, serviceParkName: '宝山高新', remark: '',
    },
    {
      id: 3, name: '演示-蒋济南', cityId: 1, cityName: '上海市',
      roles: [EmployeeRole.FRONT, EmployeeRole.PROJECT], status: EmployeeStatus.ACTIVE,
      departureAddress: '山东省济南市历下区经十路',
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      plusCapabilities: { FRONT: [PlusLevel.PLUS_0], PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N] } as PlusCapabilities,
      serviceParkId: 3, serviceParkName: '山东济南', remark: '',
    },
    {
      id: 4, name: '演示-钱徐州', cityId: 1, cityName: '上海市',
      roles: [EmployeeRole.FRONT, EmployeeRole.PROJECT], status: EmployeeStatus.ACTIVE,
      departureAddress: '江苏省徐州市云龙区淮海路',
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      plusCapabilities: { FRONT: [PlusLevel.PLUS_0], PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N] } as PlusCapabilities,
      serviceParkId: 4, serviceParkName: '江苏徐州', remark: '',
    },
    {
      id: 5, name: '演示-沈镇江', cityId: 1, cityName: '上海市',
      roles: [EmployeeRole.FRONT, EmployeeRole.PROJECT], status: EmployeeStatus.ACTIVE,
      departureAddress: '江苏省镇江市京口区中山东路',
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      plusCapabilities: { FRONT: [PlusLevel.PLUS_0], PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N] } as PlusCapabilities,
      serviceParkId: 5, serviceParkName: '江苏镇江', remark: '',
    },
  ];

  const day = '2026-06-16';
  const customers: Customer[] = [
    // 演示-范金山：金山 2 单
    { id: 101, companyName: '上海协尔泰控制技术有限公司', address: '上海市金山区亭林镇南亭公路888号', customerType: CustomerType.FOLLOW_UP, appointmentTime: dt(day, '09:30'), timeSlot: TimeSlot.MORNING, cityId: 1, cityName: '上海市', parkId: 1, parkName: '加盟-金山资本现代产业园', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    { id: 102, companyName: '上海无忧供应链管理有限公司', address: '上海市金山区朱泾镇金龙新街1688号', customerType: CustomerType.FOLLOW_UP, appointmentTime: dt(day, '13:30'), timeSlot: TimeSlot.AFTERNOON_1, cityId: 1, cityName: '上海市', parkId: 1, parkName: '加盟-金山资本现代产业园', plusCount: 1, plusLevel: PlusLevel.PLUS_1, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    // 演示-顾宝山：宝山 2 单
    { id: 103, companyName: '上海喜福来朝阳食品贸易行', address: '上海市宝山区淞发路128号', customerType: CustomerType.FOLLOW_UP, appointmentTime: dt(day, '10:00'), timeSlot: TimeSlot.MORNING, cityId: 1, cityName: '上海市', parkId: 2, parkName: '宝山高新', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    { id: 104, companyName: '上海宝冶工程技术有限公司', address: '上海市宝山区友谊路1818号', customerType: CustomerType.FOLLOW_UP, appointmentTime: dt(day, '14:00'), timeSlot: TimeSlot.AFTERNOON_1, cityId: 1, cityName: '上海市', parkId: 2, parkName: '宝山高新', plusCount: 2, plusLevel: PlusLevel.PLUS_N, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    // 演示-蒋济南：济南 2 单
    { id: 105, companyName: '济南瑞丰化工有限公司', address: '山东省济南市历下区工业南路66号', customerType: CustomerType.PROJECT, appointmentTime: dt(day, '09:00'), timeSlot: TimeSlot.MORNING, cityId: 1, cityName: '上海市', parkId: 3, parkName: '山东济南', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    { id: 106, companyName: '济南华创科技有限公司', address: '山东省济南市高新区舜华路2000号', customerType: CustomerType.FIRST_VISIT, appointmentTime: dt(day, '13:00'), timeSlot: TimeSlot.AFTERNOON_1, cityId: 1, cityName: '上海市', parkId: 3, parkName: '山东济南', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    // 演示-钱徐州：徐州 2 单
    { id: 107, companyName: '徐州工程机械配件公司', address: '江苏省徐州市云龙区淮海东路88号', customerType: CustomerType.PROJECT, appointmentTime: dt(day, '10:30'), timeSlot: TimeSlot.MORNING, cityId: 1, cityName: '上海市', parkId: 4, parkName: '江苏徐州', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    { id: 108, companyName: '徐州智联物流有限公司', address: '江苏省徐州市泉山区三环南路168号', customerType: CustomerType.PROJECT, appointmentTime: dt(day, '14:30'), timeSlot: TimeSlot.AFTERNOON_1, cityId: 1, cityName: '上海市', parkId: 4, parkName: '江苏徐州', plusCount: 1, plusLevel: PlusLevel.PLUS_1, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    // 演示-沈镇江：镇江 2 单
    { id: 109, companyName: '镇江新材料科技股份公司', address: '江苏省镇江市京口区学府路300号', customerType: CustomerType.FIRST_VISIT, appointmentTime: dt(day, '09:30'), timeSlot: TimeSlot.MORNING, cityId: 1, cityName: '上海市', parkId: 5, parkName: '江苏镇江', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
    { id: 110, companyName: '镇江港口物流发展公司', address: '江苏省镇江市润州区长江路99号', customerType: CustomerType.PROJECT, appointmentTime: dt(day, '15:00'), timeSlot: TimeSlot.AFTERNOON_1, cityId: 1, cityName: '上海市', parkId: 5, parkName: '江苏镇江', plusCount: 0, plusLevel: PlusLevel.PLUS_0, dispatchStatus: DispatchStatus.PENDING, isHandInHand: false },
  ];

  return {
    parks,
    customers,
    employees,
    cities: ['上海市'],
    stats: {
      firstVisitCount: 2,
      projectCount: 5,
      followUpCount: 3,
      employeeCount: 5,
      handInHandGroups: 0,
    },
  };
}
