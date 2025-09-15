
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ProcessMonitor {
  constructor() {
    this.platform = process.platform;
  }

  /**
   * Check if a process matching the given pattern is running
   * @param {string} processPattern - Process name pattern (supports regex)
   * @returns {Promise<boolean>}
   */
  async isProcessRunning(processPattern) {
    try {
      const processes = await this.getDetailedProcesses();
      const regex = new RegExp(processPattern, 'i'); // Case-insensitive regex
      
      // Check both process names and command lines
      return processes.some(process => {
        const nameMatch = regex.test(process.name);
        const commandMatch = regex.test(process.commandLine);
        return nameMatch || commandMatch;
      });
    } catch (error) {
      console.error('Error checking if process is running:', error);
      return false;
    }
  }

  /**
   * Get list of running processes (simple names only)
   * @returns {Promise<string[]>}
   */
  async getRunningProcesses() {
    try {
      const detailedProcesses = await this.getDetailedProcesses();
      const processNames = detailedProcesses.map(p => p.name);
      
      // Remove duplicates and return
      return [...new Set(processNames)];
    } catch (error) {
      console.error('Error getting running processes:', error);
      throw error;
    }
  }

  /**
   * Get detailed process information
   * @returns {Promise<Array>}
   */
  async getDetailedProcesses() {
    try {
      let command;
      let parseOutput;

      switch (this.platform) {
        case 'win32':
          command = 'wmic process get Name,ProcessId,CommandLine /format:csv';
          parseOutput = (stdout) => {
            return stdout
              .split('\n')
              .slice(1) // Skip header
              .filter(line => line.trim() && !line.startsWith('Node,'))
              .map(line => {
                const parts = line.split(',');
                if (parts.length >= 4) {
                  return {
                    name: (parts[2] || '').replace(/\.exe$/i, ''), // Remove .exe extension
                    pid: parts[3] || '',
                    commandLine: (parts[1] || '').trim()
                  };
                }
                return null;
              })
              .filter(proc => proc && proc.name);
          };
          break;

        case 'linux':
        default:
          // Use a more comprehensive command that gets both process name and full command
          command = 'ps -eo pid,comm,args --no-headers';
          parseOutput = (stdout) => {
            return stdout
              .split('\n')
              .filter(line => line.trim())
              .map(line => {
                const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
                if (match) {
                  return {
                    pid: match[1],
                    name: match[2], // This will be the comm (like "GameThread")
                    commandLine: match[3] // This will be the full args (like "/path/to/DeadByDaylight...")
                  };
                }
                return null;
              })
              .filter(proc => proc);
          };
          break;
      }

      const { stdout } = await execAsync(command);
      const processes = parseOutput(stdout);
      
      return processes.filter(proc => proc); // Remove any null entries
    } catch (error) {
      console.error('Error getting detailed processes:', error);
      throw error;
    }
  }

  /**
   * Debug method to help troubleshoot process detection
   * @param {string} processPattern 
   * @returns {Promise<Object>}
   */
  async debugProcessSearch(processPattern) {
    try {
      const processes = await this.getDetailedProcesses();
      const regex = new RegExp(processPattern, 'i');
      
      const matches = processes.filter(process => {
        const nameMatch = regex.test(process.name);
        const commandMatch = regex.test(process.commandLine);
        return nameMatch || commandMatch;
      });

      const potentialMatches = processes.filter(process => {
        const lowerCommand = process.commandLine.toLowerCase();
        const lowerName = process.name.toLowerCase();
        return lowerCommand.includes('dead') || 
               lowerCommand.includes('daylight') || 
               lowerCommand.includes('dbd') ||
               lowerName.includes('dead') ||
               lowerName.includes('daylight') ||
               lowerName.includes('game');
      });

      return {
        pattern: processPattern,
        exactMatches: matches,
        potentialMatches: potentialMatches,
        totalProcesses: processes.length
      };
    } catch (error) {
      console.error('Error in debug process search:', error);
      throw error;
    }
  }
}

module.exports = ProcessMonitor;