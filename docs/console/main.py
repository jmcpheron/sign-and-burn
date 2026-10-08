# On a Pico or an ESP32: the console core over USB serial. One JSON request per line in, one JSON
# answer per line out, the same lines the page sends core.handle() in the browser. Copy the files
# console/manifest.json lists onto the board (mpremote cp), and this runs at power-up.
import sys
import core


def run():
    while True:
        line = sys.stdin.readline()
        if not line:
            return
        line = line.strip()
        if line:
            print(core.handle(line))


run()
