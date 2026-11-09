"""Check the package boundaries established by the runtime split."""

import argparse
from pathlib import Path
import re
import zipfile


PLATFORM = Path(__file__).resolve().parents[1]
SOURCE = PLATFORM / "src/main/java"
IMPORT = re.compile(r"^import\s+(?:static\s+)?([\w.*]+);", re.MULTILINE)
PORTS_ONLY = (
    "agentship.platform.archive.application",
    "agentship.platform.runtime.application.collaboration",
    "agentship.platform.runtime.application.execution",
    "agentship.platform.runtime.application.gitprep",
)


def verify(jar):
    for source in SOURCE.rglob("*.java"):
        package = ".".join(source.relative_to(SOURCE).parts[:-1])
        imports = IMPORT.findall(source.read_text())
        assert not package.startswith("agentship.platform.git"), source
        for dependency in imports:
            assert not dependency.startswith("agentship.platform.git."), (source, dependency)
            if package.startswith(PORTS_ONLY):
                assert not dependency.startswith("org.springframework.jdbc."), (source, dependency)
                assert not dependency.startswith(package.split(".application")[0] + ".infrastructure."), (source, dependency)
            if package == "agentship.platform.runtime.domain":
                assert dependency.startswith("java."), (source, dependency)
            if package.startswith("agentship.platform.runtime"):
                assert not dependency.startswith("agentship.platform.archive."), (source, dependency)
            if package.startswith("agentship.platform.archive") and dependency.startswith("agentship.platform.runtime."):
                assert dependency.startswith("agentship.platform.runtime.api."), (source, dependency)
            if package.startswith("agentship.platform.workbench") and dependency.startswith(
                    ("agentship.platform.archive.", "agentship.platform.runtime.")):
                assert dependency.split(".")[3] == "api", (source, dependency)
            if package.startswith("agentship.platform.device"):
                assert not dependency.startswith("agentship.platform.runtime."), (source, dependency)
            if package.startswith("agentship.worker"):
                assert not dependency.startswith("agentship.platform."), (source, dependency)

    with zipfile.ZipFile(jar) as package:
        classes = set(package.namelist())
    prefix = "BOOT-INF/classes/agentship/"
    assert not any(name.startswith(prefix + "platform/git/") for name in classes)
    assert not any(name.startswith(prefix + "platform/run/") for name in classes)
    for name in ("platform/runtime/transport/WorkerJobController.class",
                 "platform/archive/transport/ArtifactArchiveController.class",
                 "platform/workbench/transport/RunDashboardController.class"):
        assert prefix + name in classes, name
    print("PASS runtime module boundaries and packaged entry points")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, default=PLATFORM / "target/agentship-platform-0.1.0-SNAPSHOT.jar")
    verify(parser.parse_args().jar)
