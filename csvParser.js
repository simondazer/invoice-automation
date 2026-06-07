/**
 * CSV表格解析器
 * 支持默认映射和特殊规则映射的解析
 */

const fs = require('fs');
const path = require('path');

/**
 * CSV解析器配置
 */
class CSVParserConfig {
  constructor(options = {}) {
    this.delimiter = options.delimiter || ',';
    this.headers = options.headers || null;
    this.skipEmptyLines = options.skipEmptyLines !== false;
    this.trimFields = options.trimFields !== false;
    this.encoding = options.encoding || 'utf8';
  }
}

/**
 * CSV行解析器
 */
class CSVRowParser {
  static parseLine(line, delimiter = ',') {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        result.push(current);
        current = '';
        i++;
        continue;
      }

      current += char;
      i++;
    }

    result.push(current);
    return result;
  }
}

/**
 * CSV文件解析器
 */
class CSVParser {
  constructor(config = new CSVParserConfig()) {
    this.config = config;
  }

  /**
   * 解析CSV文件
   */
  async parseFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, this.config.encoding);
      return this.parseContent(content);
    } catch (error) {
      throw new Error(`解析CSV文件失败: ${filePath} - ${error.message}`);
    }
  }

  /**
   * 解析CSV内容
   */
  parseContent(content) {
    const lines = content.split(/\r?\n/);
    const result = [];
    let headers = this.config.headers;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 跳过空行
      if (this.config.skipEmptyLines && !line.trim()) {
        continue;
      }

      const row = CSVRowParser.parseLine(line, this.config.delimiter);

      // 处理字段修剪
      if (this.config.trimFields) {
        row.forEach((field, index) => {
          row[index] = field.trim();
        });
      }

      // 如果没有指定headers，使用第一行作为headers
      if (!headers && result.length === 0) {
        headers = row;
        continue;
      }

      // 构建对象
      if (headers) {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        result.push(obj);
      } else {
        result.push(row);
      }
    }

    return result;
  }
}

/**
 * 资源映射CSV解析器
 */
class ResourceMappingCSVParser {
  constructor(options = {}) {
    this.parser = new CSVParser(new CSVParserConfig(options));
    this.logger = options.logger || null;
  }

  /**
   * 解析默认映射CSV
   * 预期格式: oldResourceName,newResourceName
   */
  async parseDefaultMapping(filePath) {
    try {
      this.logger?.info(`解析默认映射文件: ${filePath}`);

      const data = await this.parser.parseFile(filePath);
      const mappings = new Map();

      data.forEach((row, index) => {
        const oldName = row.oldResourceName || row['旧资源名'] || row[Object.keys(row)[0]];
        const newName = row.newResourceName || row['新资源名'] || row[Object.keys(row)[1]];

        if (!oldName || !newName) {
          this.logger?.warn(`第${index + 1}行数据不完整`, row);
          return;
        }

        mappings.set(oldName, {
          oldName,
          newName,
          type: 'default'
        });
      });

      this.logger?.info(`默认映射解析完成，共${mappings.size}条记录`);
      return mappings;

    } catch (error) {
      this.logger?.error(`解析默认映射失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 解析特殊映射CSV
   * 预期格式: oldResourceName,newResourceName,schemaPattern
   */
  async parseSpecialMapping(filePath) {
    try {
      this.logger?.info(`解析特殊映射文件: ${filePath}`);

      const data = await this.parser.parseFile(filePath);
      const mappings = new Map();

      data.forEach((row, index) => {
        const oldName = row.oldResourceName || row['旧资源名'] || row[Object.keys(row)[0]];
        const newName = row.newResourceName || row['新资源名'] || row[Object.keys(row)[1]];
        const schemaPattern = row.schemaPattern || row['Schema模式'] || row[Object.keys(row)[2]];

        if (!oldName || !newName) {
          this.logger?.warn(`第${index + 1}行数据不完整`, row);
          return;
        }

        const key = schemaPattern ? `${schemaPattern}:${oldName}` : oldName;
        mappings.set(key, {
          oldName,
          newName,
          schemaPattern: schemaPattern || null,
          type: 'special'
        });
      });

      this.logger?.info(`特殊映射解析完成，共${mappings.size}条记录`);
      return mappings;

    } catch (error) {
      this.logger?.error(`解析特殊映射失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 验证映射数据
   */
  validateMapping(mappings, type = 'default') {
    const errors = [];
    const warnings = [];

    mappings.forEach((mapping, key) => {
      const { oldName, newName, schemaPattern } = mapping;

      // 检查空值
      if (!oldName || !newName) {
        errors.push(`映射键${key}包含空值: oldName=${oldName}, newName=${newName}`);
      }

      // 检查循环映射
      if (oldName === newName) {
        warnings.push(`映射键${key}的旧名称和新名称相同: ${oldName}`);
      }

      // 检查特殊映射的schemaPattern
      if (type === 'special' && schemaPattern) {
        if (schemaPattern.includes(':')) {
          warnings.push(`Schema模式${schemaPattern}包含冒号，可能影响键解析`);
        }
      }
    });

    // 检查重复映射
    const seen = new Set();
    mappings.forEach((mapping, key) => {
      if (seen.has(mapping.oldName)) {
        warnings.push(`资源名${mapping.oldName}存在重复映射`);
      }
      seen.add(mapping.oldName);
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      total: mappings.size
    };
  }

  /**
   * 合并多个映射
   */
  mergeMappings(...mappingSets) {
    const merged = new Map();

    mappingSets.forEach((mappings, index) => {
      if (!mappings || !(mappings instanceof Map)) {
        this.logger?.warn(`第${index + 1}个映射集无效，跳过`);
        return;
      }

      mappings.forEach((mapping, key) => {
        if (merged.has(key)) {
          this.logger?.warn(`映射键${key}已存在，将被覆盖`);
        }
        merged.set(key, mapping);
      });
    });

    return merged;
  }

  /**
   * 导出映射到CSV
   */
  async exportToCSV(mappings, outputPath, options = {}) {
    try {
      const { headers = ['oldResourceName', 'newResourceName', 'schemaPattern'] } = options;

      const records = Array.from(mappings.entries()).map(([key, mapping]) => ({
        oldResourceName: mapping.oldName,
        newResourceName: mapping.newName,
        schemaPattern: mapping.schemaPattern || ''
      }));

      const csvContent = this.convertToCSV(records, headers);
      fs.writeFileSync(outputPath, csvContent, 'utf8');

      this.logger?.info(`映射已导出到: ${outputPath}`);
      return outputPath;

    } catch (error) {
      this.logger?.error(`导出映射失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 转换为CSV格式
   */
  convertToCSV(data, headers) {
    const csvRows = [];

    // 添加表头
    csvRows.push(headers.join(','));

    // 添加数据行
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] || '';
        // 如果值包含逗号或引号，需要用引号包裹
        if (value.includes(',') || value.includes('"')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * 创建示例CSV文件
   */
  createSampleCSV(outputPath, type = 'default') {
    let content = '';

    if (type === 'default') {
      content = `oldResourceName,newResourceName
resource1,newResource1
resource2,newResource2
resource3,newResource3`;
    } else if (type === 'special') {
      content = `oldResourceName,newResourceName,schemaPattern
specialResource1,newSpecialResource1,userSchema
specialResource2,newSpecialResource2,productSchema
commonResource,newCommonResource,`;
    }

    fs.writeFileSync(outputPath, content, 'utf8');
    this.logger?.info(`示例CSV文件已创建: ${outputPath}`);
    return outputPath;
  }
}

/**
 * 映射缓存管理器
 */
class MappingCacheManager {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 3600000; // 1小时
    this.logger = options.logger || null;
  }

  /**
   * 获取缓存的映射
   */
  get(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 设置缓存的映射
   */
  set(key, data) {
    // 清理过期缓存
    this.cleanup();

    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.logger?.info('映射缓存已清空');
  }

  /**
   * 获取缓存状态
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }
}

module.exports = {
  CSVParserConfig,
  CSVRowParser,
  CSVParser,
  ResourceMappingCSVParser,
  MappingCacheManager
};