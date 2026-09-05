export interface YosysStatModule {
  numWires: number;
  numWireBits: number;
  numPubWires: number;
  numPubWireBits: number;
  numMemories: number;
  numProcesses: number;
  numCells: number;
  cellsByType: Record<string, number>;
}

export interface YosysStatResult {
  creator: string;
  invocation: string;
  design: YosysStatModule;
  modules: Record<string, YosysStatModule>;
}

export interface YosysSynthesizeResult {
  success: boolean;
  topModule: string;
  target: string;
  cellCount: number;
  cellsByType: Record<string, number>;
  wireCount: number;
  warnings: string[];
  errors: string[];
  netlistPath?: string;
  rawStdout: string;
  rawStderr: string;
}

export interface YosysLatchInfo {
  module: string;
  variable: string;
  line?: number;
  rawMessage: string;
}

export interface YosysCheckResult {
  success: boolean;
  hasLatches: boolean;
  latches: YosysLatchInfo[];
  hasCombinationalLoops: boolean;
  warnings: string[];
  errors: string[];
  rawStdout: string;
  rawStderr: string;
}

export interface YosysHierarchyModule {
  name: string;
  isTop: boolean;
  submodules: string[];
}

export interface YosysHierarchyResult {
  success: boolean;
  topModule: string;
  modules: YosysHierarchyModule[];
  missingModules: string[];
  warnings: string[];
  rawStdout: string;
  rawStderr: string;
}

export interface YosysToolchainInfo {
  runtime: "podman" | "docker" | "host";
  image?: string;
  yosysVersion: string;
  availableTargets: string[];
}
