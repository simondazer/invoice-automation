const fs = require('fs');
const path = require('path');

const DEFAULT_UNKNOWN_CITY = '未知城市';

const MUNICIPALITIES = ['北京', '上海', '天津', '重庆'];

const KNOWN_CITIES = [
  ...MUNICIPALITIES,
  '石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水',
  '太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁',
  '呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布',
  '沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛',
  '长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边',
  '哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河', '牡丹江', '黑河', '绥化', '大兴安岭',
  '南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁',
  '杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水',
  '合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城',
  '福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德',
  '南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶',
  '济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽',
  '郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源',
  '武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架',
  '长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底', '湘西',
  '广州', '韶关', '深圳', '珠海', '汕头', '佛山', '江门', '湛江', '茂名', '肇庆', '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州', '揭阳', '云浮',
  '南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左',
  '海口', '三亚', '三沙', '儋州',
  '成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山',
  '贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔西南', '黔东南', '黔南',
  '昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆',
  '拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里',
  '西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛',
  '兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳', '定西', '陇南', '临夏', '甘南',
  '西宁', '海东', '海北', '黄南', '海南', '果洛', '玉树', '海西',
  '银川', '石嘴山', '吴忠', '固原', '中卫',
  '乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰', '石河子', '阿拉尔', '图木舒克', '五家渠', '北屯', '铁门关', '双河', '可克达拉', '昆玉', '胡杨河',
  '香港', '澳门', '台北', '新北', '桃园', '台中', '台南', '高雄'
];

/**
 * 从发票自身信息中识别城市
 */
class InvoiceCityIdentifier {
  constructor(options = {}) {
    this.unknownCityName = options.unknownCityName || DEFAULT_UNKNOWN_CITY;
    this.extraCities = options.extraCities || [];
    this.cityAliases = {
      北京市: '北京',
      上海市: '上海',
      天津市: '天津',
      重庆市: '重庆',
      ...options.cityAliases
    };
    this.cityList = [...new Set([...KNOWN_CITIES, ...this.extraCities])]
      .sort((a, b) => b.length - a.length);
  }

  /**
   * 识别发票所属城市
   */
  identify(invoice = {}) {
    const candidates = this.collectCandidates(invoice);

    for (const candidate of candidates) {
      const city = this.matchKnownCity(candidate.value);
      if (city) {
        return {
          city,
          confidence: 'high',
          source: candidate.source,
          matchedText: candidate.value
        };
      }
    }

    for (const candidate of candidates) {
      const city = this.matchCityBySuffix(candidate.value);
      if (city) {
        return {
          city,
          confidence: 'medium',
          source: candidate.source,
          matchedText: candidate.value
        };
      }
    }

    return {
      city: this.unknownCityName,
      confidence: 'none',
      source: null,
      matchedText: null
    };
  }

  collectCandidates(invoice) {
    const candidates = [];
    const add = (source, value) => {
      if (value === null || value === undefined) {
        return;
      }
      const normalized = this.normalizeText(value);
      if (normalized) {
        candidates.push({ source, value: normalized });
      }
    };

    const highPriorityFields = [
      'city',
      'invoiceCity',
      'billingCity',
      'issuerCity',
      'taxCity',
      'region',
      'area'
    ];

    highPriorityFields.forEach(field => add(field, invoice[field]));

    const textFields = [
      'taxBureau',
      'issuer',
      'issuerRegion',
      'sellerAddress',
      'sellerName',
      'buyerAddress',
      'buyerName',
      'invoiceTitle',
      'title',
      'remarks',
      'ocrText',
      'rawText',
      'text'
    ];

    textFields.forEach(field => add(field, invoice[field]));

    if (invoice.seller) {
      add('seller.name', invoice.seller.name);
      add('seller.address', invoice.seller.address);
      add('seller.taxBureau', invoice.seller.taxBureau);
    }

    if (invoice.buyer) {
      add('buyer.name', invoice.buyer.name);
      add('buyer.address', invoice.buyer.address);
    }

    return candidates;
  }

  matchKnownCity(text) {
    if (this.cityAliases[text]) {
      return this.cityAliases[text];
    }

    const normalized = this.stripAdministrativeSuffix(text);
    if (this.cityAliases[normalized]) {
      return this.cityAliases[normalized];
    }

    for (const city of this.cityList) {
      if (text.includes(`${city}市`) || text.includes(city)) {
        return city;
      }
    }

    return null;
  }

  matchCityBySuffix(text) {
    const direct = text.match(/([一-龥]{2,8})市/);
    if (direct) {
      return this.stripAdministrativeSuffix(direct[1]);
    }

    const autonomousPrefecture = text.match(/([一-龥]{2,10})自治州/);
    if (autonomousPrefecture) {
      return this.stripAdministrativeSuffix(autonomousPrefecture[1]);
    }

    const league = text.match(/([一-龥]{2,10})盟/);
    if (league) {
      return this.stripAdministrativeSuffix(league[1]);
    }

    return null;
  }

  stripAdministrativeSuffix(value) {
    return this.normalizeText(value)
      .replace(/特别行政区$/, '')
      .replace(/自治州$/, '')
      .replace(/地区$/, '')
      .replace(/盟$/, '')
      .replace(/市$/, '');
  }

  normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[()（）【】\[\]{}]/g, '')
      .trim();
  }
}

/**
 * 将发票图片、文档等产物按 日期/城市 归档
 */
class InvoiceCityOrganizer {
  constructor(options = {}) {
    this.outputRoot = options.outputRoot || './invoice-output';
    this.backupRoot = options.backupRoot || path.join(this.outputRoot, '_backup');
    this.date = options.date || null;
    this.unknownCityName = options.unknownCityName || DEFAULT_UNKNOWN_CITY;
    this.identifier = options.identifier || new InvoiceCityIdentifier(options);
    this.finalArtifactTypes = options.finalArtifactTypes || ['image'];
    this.backupNonFinalArtifacts = options.backupNonFinalArtifacts !== false;
    this.logger = options.logger || console;
  }

  /**
   * 归档单张发票的产物
   */
  organize(invoice, artifacts = [], options = {}) {
    const cityResult = this.identifier.identify(invoice);
    const date = this.resolveDate(invoice, options.date || this.date);
    const cityFolderName = this.sanitizePathSegment(cityResult.city);
    const targetDir = path.join(this.outputRoot, date, cityFolderName);
    const backupDir = path.join(this.backupRoot, date, cityFolderName);

    const copiedFiles = [];
    const backupFiles = [];
    const skippedFiles = [];

    artifacts.forEach((artifact) => {
      const normalized = this.normalizeArtifact(artifact);
      if (this.isFinalArtifact(normalized)) {
        copiedFiles.push(this.copyArtifact(normalized, targetDir, options));
        return;
      }

      if (this.backupNonFinalArtifacts) {
        backupFiles.push(this.copyArtifact(normalized, backupDir, options));
      } else {
        skippedFiles.push(normalized);
      }
    });

    return {
      date,
      city: cityResult.city,
      cityResult,
      targetDir,
      backupDir,
      files: copiedFiles,
      backupFiles,
      skippedFiles
    };
  }

  /**
   * 批量归档，并返回按 日期/城市 汇总的分组信息
   */
  organizeBatch(items = [], options = {}) {
    const results = items.map(item => this.organize(
      item.invoice || item,
      item.artifacts || item.files || [],
      options
    ));

    return {
      total: results.length,
      groups: this.groupResults(results),
      results
    };
  }

  copyArtifact(artifact, targetDir, options = {}) {
    const normalized = typeof artifact === 'string' ? this.normalizeArtifact(artifact) : artifact;
    const targetPath = this.resolveTargetPath(targetDir, normalized.filename);

    if (!options.dryRun) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(normalized.sourcePath, targetPath);
    }

    return {
      sourcePath: normalized.sourcePath,
      targetPath,
      filename: path.basename(targetPath),
      type: normalized.type
    };
  }

  isFinalArtifact(artifact) {
    return this.finalArtifactTypes.includes(artifact.type);
  }

  normalizeArtifact(artifact) {
    if (typeof artifact === 'string') {
      return {
        sourcePath: artifact,
        filename: path.basename(artifact),
        type: this.detectArtifactType(artifact)
      };
    }

    const sourcePath = artifact.path || artifact.filePath || artifact.sourcePath;
    if (!sourcePath) {
      throw new Error('产物缺少文件路径，请提供 path、filePath 或 sourcePath');
    }

    return {
      sourcePath,
      filename: artifact.filename || artifact.name || path.basename(sourcePath),
      type: artifact.type || this.detectArtifactType(sourcePath)
    };
  }

  resolveTargetPath(targetDir, filename) {
    const safeFilename = this.sanitizeFilename(filename);
    let targetPath = path.join(targetDir, safeFilename);

    if (!fs.existsSync(targetPath)) {
      return targetPath;
    }

    const ext = path.extname(safeFilename);
    const baseName = path.basename(safeFilename, ext);
    let index = 1;

    while (fs.existsSync(targetPath)) {
      targetPath = path.join(targetDir, `${baseName}_${index}${ext}`);
      index++;
    }

    return targetPath;
  }

  resolveDate(invoice = {}, fallbackDate = null) {
    const rawDate = fallbackDate || invoice.invoiceDate || invoice.date || invoice.issueDate || invoice.billingDate;

    if (!rawDate) {
      return new Date().toISOString().slice(0, 10);
    }

    const text = String(rawDate).trim();
    const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (match) {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return this.sanitizePathSegment(text);
  }

  groupResults(results) {
    return results.reduce((groups, result) => {
      groups[result.date] = groups[result.date] || {};
      groups[result.date][result.city] = groups[result.date][result.city] || {
        targetDir: result.targetDir,
        count: 0,
        files: []
      };
      groups[result.date][result.city].count++;
      groups[result.date][result.city].files.push(...result.files);
      return groups;
    }, {});
  }

  detectArtifactType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'].includes(ext)) {
      return 'image';
    }
    if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.json', '.xml', '.ofd'].includes(ext)) {
      return 'document';
    }
    return 'file';
  }

  sanitizePathSegment(value) {
    const sanitized = String(value || this.unknownCityName)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '')
      .trim();

    return sanitized || this.unknownCityName;
  }

  sanitizeFilename(filename) {
    const parsed = path.parse(filename || 'artifact');
    const safeName = this.sanitizePathSegment(parsed.name || 'artifact');
    const safeExt = parsed.ext.replace(/[\\/:*?"<>|]/g, '_');
    return `${safeName}${safeExt}`;
  }
}

module.exports = {
  DEFAULT_UNKNOWN_CITY,
  KNOWN_CITIES,
  InvoiceCityIdentifier,
  InvoiceCityOrganizer
};
