FROM pytorch/pytorch:latest
ARG UID=999

RUN groupadd -g $UID codeforme
RUN useradd -r -u $UID -g codeforme -d /codeforme codeforme
RUN mkdir -p /codeforme
RUN chown -R codeforme:codeforme /codeforme
USER codeforme

WORKDIR /codeforme
COPY requirements.txt ./
RUN pip3 install -r requirements.txt
COPY src/ .
CMD ["python3", "./app.py"]
