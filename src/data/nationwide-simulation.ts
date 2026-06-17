/**
 * 全国省市园区 + 员工 + 客户 纯模拟数据
 * 与服务器 Excel 存量数据完全隔离，仅用于规则合理性压测
 */

import {
  Customer,
  Employee,
  CustomerType,
  TimeSlot,
  EmployeeRole,
  EmployeeStatus,
  PlusLevel,
  DispatchStatus,
  InvestmentPark,
} from '../types';
import { ImportResult } from '../services/excel-importer';

export const NATIONWIDE_SIM_TAG = '全国模拟';

/** 省/市 + 园区地标（园区名格式：城市简称-地标，便于园区匹配规则） */
const REGION_CATALOG: {
  cityName: string;
  parks: { label: string; district: string }[];
}[] = [
  { cityName: '北京市', parks: [{ label: '海淀', district: '海淀区' }, { label: '朝阳', district: '朝阳区' }, { label: '丰台', district: '丰台区' }] },
  { cityName: '天津市', parks: [{ label: '和平', district: '和平区' }, { label: '滨海', district: '滨海新区' }] },
  { cityName: '上海市', parks: [{ label: '浦东', district: '浦东新区' }, { label: '闵行', district: '闵行区' }, { label: '徐汇', district: '徐汇区' }] },
  { cityName: '重庆市', parks: [{ label: '渝中', district: '渝中区' }, { label: '江北', district: '江北区' }] },
  { cityName: '石家庄市', parks: [{ label: '裕华', district: '裕华区' }, { label: '长安', district: '长安区' }] },
  { cityName: '太原市', parks: [{ label: '小店', district: '小店区' }, { label: '迎泽', district: '迎泽区' }] },
  { cityName: '呼和浩特市', parks: [{ label: '新城', district: '新城区' }, { label: '赛罕', district: '赛罕区' }] },
  { cityName: '沈阳市', parks: [{ label: '和平', district: '和平区' }, { label: '浑南', district: '浑南区' }] },
  { cityName: '大连市', parks: [{ label: '中山', district: '中山区' }, { label: '高新', district: '高新技术园区' }] },
  { cityName: '长春市', parks: [{ label: '朝阳', district: '朝阳区' }, { label: '南关', district: '南关区' }] },
  { cityName: '哈尔滨市', parks: [{ label: '南岗', district: '南岗区' }, { label: '松北', district: '松北区' }] },
  { cityName: '南京市', parks: [{ label: '鼓楼', district: '鼓楼区' }, { label: '江宁', district: '江宁区' }, { label: '江北', district: '江北新区' }] },
  { cityName: '苏州市', parks: [{ label: '工业园', district: '工业园区' }, { label: '高新', district: '高新区' }] },
  { cityName: '无锡市', parks: [{ label: '滨湖', district: '滨湖区' }, { label: '新吴', district: '新吴区' }] },
  { cityName: '杭州市', parks: [{ label: '西湖', district: '西湖区' }, { label: '滨江', district: '滨江区' }, { label: '余杭', district: '余杭区' }] },
  { cityName: '宁波市', parks: [{ label: '鄞州', district: '鄞州区' }, { label: '北仑', district: '北仑区' }] },
  { cityName: '合肥市', parks: [{ label: '蜀山', district: '蜀山区' }, { label: '包河', district: '包河区' }] },
  { cityName: '福州市', parks: [{ label: '鼓楼', district: '鼓楼区' }, { label: '仓山', district: '仓山区' }] },
  { cityName: '厦门市', parks: [{ label: '思明', district: '思明区' }, { label: '湖里', district: '湖里区' }] },
  { cityName: '南昌市', parks: [{ label: '红谷滩', district: '红谷滩区' }, { label: '东湖', district: '东湖区' }] },
  { cityName: '济南市', parks: [{ label: '历下', district: '历下区' }, { label: '高新', district: '高新区' }] },
  { cityName: '青岛市', parks: [{ label: '市南', district: '市南区' }, { label: '崂山', district: '崂山区' }] },
  { cityName: '郑州市', parks: [{ label: '金水', district: '金水区' }, { label: '郑东', district: '郑东新区' }] },
  { cityName: '武汉市', parks: [{ label: '武昌', district: '武昌区' }, { label: '光谷', district: '东湖新技术开发区' }, { label: '江汉', district: '江汉区' }] },
  { cityName: '长沙市', parks: [{ label: '岳麓', district: '岳麓区' }, { label: '雨花', district: '雨花区' }] },
  { cityName: '广州市', parks: [{ label: '天河', district: '天河区' }, { label: '黄埔', district: '黄埔区' }, { label: '番禺', district: '番禺区' }] },
  { cityName: '深圳市', parks: [{ label: '南山', district: '南山区' }, { label: '福田', district: '福田区' }, { label: '宝安', district: '宝安区' }] },
  { cityName: '珠海市', parks: [{ label: '香洲', district: '香洲区' }, { label: '横琴', district: '横琴新区' }] },
  { cityName: '南宁市', parks: [{ label: '青秀', district: '青秀区' }, { label: '西乡塘', district: '西乡塘区' }] },
  { cityName: '海口市', parks: [{ label: '龙华', district: '龙华区' }, { label: '美兰', district: '美兰区' }] },
  { cityName: '成都市', parks: [{ label: '高新', district: '高新区' }, { label: '武侯', district: '武侯区' }, { label: '天府', district: '天府新区' }] },
  { cityName: '贵阳市', parks: [{ label: '观山湖', district: '观山湖区' }, { label: '南明', district: '南明区' }] },
  { cityName: '昆明市', parks: [{ label: '五华', district: '五华区' }, { label: '官渡', district: '官渡区' }] },
  { cityName: '拉萨市', parks: [{ label: '城关', district: '城关区' }, { label: '堆龙', district: '堆龙德庆区' }] },
  { cityName: '西安市', parks: [{ label: '雁塔', district: '雁塔区' }, { label: '高新', district: '高新区' }] },
  { cityName: '兰州市', parks: [{ label: '城关', district: '城关区' }, { label: '七里河', district: '七里河区' }] },
  { cityName: '西宁市', parks: [{ label: '城东', district: '城东区' }, { label: '城西', district: '城西区' }] },
  { cityName: '银川市', parks: [{ label: '金凤', district: '金凤区' }, { label: '西夏', district: '西夏区' }] },
  { cityName: '乌鲁木齐市', parks: [{ label: '天山', district: '天山区' }, { label: '高新', district: '高新技术产业开发区' }] },
];

const CUSTOMERS_PER_PARK = [
  { customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.MORNING },
  { customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.MORNING },
  { customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1 },
  { customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_1 },
  { customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_2 },
  { customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_2 },
] as const;

function cityShortName(cityName: string): string {
  return cityName.replace(/市$/, '');
}

function buildFullRoles(): EmployeeRole[] {
  return [EmployeeRole.FRONT, EmployeeRole.BACK, EmployeeRole.PROJECT];
}

function buildPlusCaps() {
  return {
    FRONT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
    PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
    BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
  };
}

export interface NationwideSimulationMeta {
  cityCount: number;
  parkCount: number;
  employeeCount: number;
  customerCount: number;
  tag: string;
  isolatedFromProduction: boolean;
}

export function buildNationwideSimulationData(): ImportResult & { meta: NationwideSimulationMeta } {
  const parks: InvestmentPark[] = [];
  const employees: Employee[] = [];
  const customers: Customer[] = [];
  const cities: string[] = [];
  const cityIdByName = new Map<string, number>();

  let cityIdSeq = 96001;
  let parkIdSeq = 96101;
  let employeeIdSeq = 96201;
  let customerIdSeq = 96301;

  for (const region of REGION_CATALOG) {
    if (!cityIdByName.has(region.cityName)) {
      cityIdByName.set(region.cityName, cityIdSeq++);
      cities.push(region.cityName);
    }
    const cityId = cityIdByName.get(region.cityName)!;
    const shortCity = cityShortName(region.cityName);

    for (const parkDef of region.parks) {
      const parkName = `${shortCity}-${parkDef.label}`;
      const parkId = parkIdSeq++;
      const parkAddress = `${region.cityName}${parkDef.district}产业园路1号`;

      parks.push({
        id: parkId,
        name: parkName,
        cityId,
        cityName: region.cityName,
        address: parkAddress,
        status: 'ACTIVE',
      });

      for (let ei = 0; ei < 2; ei++) {
        const empId = employeeIdSeq++;
        const departureAddress = `${region.cityName}${parkDef.district}服务路${10 + ei}号`;
        employees.push({
          id: empId,
          name: `模拟-${shortCity}-${parkDef.label}-${ei + 1}`,
          cityId,
          cityName: region.cityName,
          serviceParkId: parkId,
          serviceParkName: parkName,
          roles: buildFullRoles(),
          status: EmployeeStatus.ACTIVE,
          departureAddress,
          plusCapabilities: buildPlusCaps(),
          orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1, TimeSlot.AFTERNOON_2],
          remark: `[${NATIONWIDE_SIM_TAG}] ${region.cityName} ${parkName} 全能员工，可一人多单`,
        });
      }

      CUSTOMERS_PER_PARK.forEach((custDef, ci) => {
        const customerId = customerIdSeq++;
        customers.push({
          id: customerId,
          companyName: `模拟-${shortCity}-${parkDef.label}-客户${ci + 1}`,
          address: `${region.cityName}${parkDef.district}企业大道${100 + ci}号`,
          customerType: custDef.customerType,
          appointmentTime: new Date('2026-06-15T09:00:00'),
          timeSlot: custDef.timeSlot,
          cityId,
          cityName: region.cityName,
          parkId,
          parkName,
          plusCount: 0,
          plusLevel: PlusLevel.PLUS_0,
          isHandInHand: false,
          dispatchStatus: DispatchStatus.PENDING,
        });
      });
    }
  }

  return {
    parks,
    customers,
    employees,
    cities,
    stats: {
      firstVisitCount: customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length,
      projectCount: customers.filter((c) => c.customerType === CustomerType.PROJECT).length,
      followUpCount: customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length,
      employeeCount: employees.length,
      handInHandGroups: 0,
    },
    meta: {
      cityCount: cities.length,
      parkCount: parks.length,
      employeeCount: employees.length,
      customerCount: customers.length,
      tag: NATIONWIDE_SIM_TAG,
      isolatedFromProduction: true,
    },
  };
}
