"""Run after packaging the platform; requires Java 21 on PATH."""
from pathlib import Path
import os
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="agentship-catalog-") as scratch:
    work = Path(scratch)
    with zipfile.ZipFile(root / "target/agentship-platform-0.1.0-SNAPSHOT.jar") as archive:
        for name in archive.namelist():
            if name.startswith("BOOT-INF/lib/") and name.endswith(".jar"):
                archive.extract(name, work)
    classpath = os.pathsep.join([str(root / "target/classes"), str(work / "BOOT-INF/lib/*")])
    subprocess.run(["javac", "-cp", classpath, "-d", str(work), str(root / "test/LocalSkillCatalogCheck.java")], check=True)
    subprocess.run(["java", "-cp", classpath + os.pathsep + str(work),
                    "agentship.platform.config.LocalSkillCatalogCheck", str(work / "fixtures")], check=True)
