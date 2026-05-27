from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uvicorn
import os

from threat_analyzer import ThreatAnalyzer

app = FastAPI(title="Tactical Threat API", description="提供战场态势数据的外部查询接口")

# 全局分析器实例
analyzer = ThreatAnalyzer()

class LoadReportRequest(BaseModel):
    report_path: str

class PointQueryRequest(BaseModel):
    longitude: float
    latitude: float

@app.post("/api/v1/load")
def load_situation(req: LoadReportRequest):
    """
    加载由 visualizer 产生的报告 JSON 文件。
    由于没有数据库，外部程序可以直接传递 JSON 文件路径（例如后台保存的提取结果文件）给该接口。
    """
    if not os.path.exists(req.report_path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.report_path}")
    try:
        analyzer.load_from_json_file(req.report_path)
        return {"message": "加载成功", "targets_count": len(analyzer.targets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载失败: {str(e)}")

@app.get("/api/v1/targets/threat-indices")
def get_target_threat_indices():
    """
    获取各个目标的威胁指数
    """
    if not analyzer.targets:
        raise HTTPException(status_code=400, detail="未加载态势数据，请先调用 /api/v1/load 接口")
    return {"data": analyzer.get_all_target_threat_indices()}

@app.post("/api/v1/evaluate-point")
def evaluate_point(req: PointQueryRequest):
    """
    输入一个点的经纬度，获取该点受各个目标影响的威胁度
    """
    if not analyzer.targets:
        raise HTTPException(status_code=400, detail="未加载态势数据，请先调用 /api/v1/load 接口")
    
    result = analyzer.evaluate_point(req.longitude, req.latitude)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
        
    return {"data": result}

if __name__ == "__main__":
    print("启动 Threat API Server: http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
